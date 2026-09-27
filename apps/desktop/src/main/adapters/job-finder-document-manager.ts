import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BrowserWindow } from "electron";
import type { JobFinderDocumentManager } from "@unemployed/job-finder";
import JSZip from "jszip";

import { getPdfPageCount } from "./resume-document";
import {
  listLocalResumeTemplates,
  renderResumeTemplateHtml,
  sanitizeSegment,
} from "../../shared/job-finder-resume-renderer";

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}

/**
 * A letter on a page: the text, in paragraphs, with ordinary margins.
 *
 * Deliberately plain. A letter that looks like a letter is what an employer
 * expects; anything more decorative reads as generated.
 */
function renderLetterHtml(text: string, authorName: string): string {
  const paragraphs = text
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map(
      (paragraph) =>
        `<p>${escapeHtml(paragraph).replace(/\n/gu, "<br />")}</p>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(authorName)} — cover letter</title>
    <style>
      @page { size: Letter; margin: 22mm 20mm; }
      body {
        font-family: Georgia, "Times New Roman", serif;
        font-size: 11.5pt;
        line-height: 1.55;
        color: #111;
        margin: 0;
      }
      p { margin: 0 0 12pt; }
    </style>
  </head>
  <body>
${paragraphs}
  </body>
</html>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

async function renderLetterDocx(text: string): Promise<Buffer> {
  const zip = new JSZip();
  const paragraphs = text
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => {
      const runs = paragraph
        .split(/\n/u)
        .map(
          (line, index) =>
            `${index > 0 ? "<w:br/>" : ""}<w:t xml:space="preserve">${escapeXml(line)}</w:t>`,
        )
        .join("");
      return `<w:p><w:pPr><w:spacing w:after="200" w:line="360" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="23"/></w:rPr>${runs}</w:r></w:p>`;
    })
    .join("");

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.folder("_rels")?.file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.folder("word")?.file(
    "document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${paragraphs}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1247" w:right="1134" w:bottom="1247" w:left="1134"/></w:sectPr></w:body>
</w:document>`,
  );
  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

interface CreateLocalJobFinderDocumentManagerOptions {
  outputDirectory: string;
  previewTestMode?: "ok" | "fail_once";
}

function throwIfPreviewAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }

  throw new DOMException("Resume preview was superseded.", "AbortError");
}

async function renderPdfFromHtml(
  html: string,
  htmlPath: string,
  targetPath: string,
): Promise<void> {
  const exportWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // A hidden print window that never finishes must fail loudly, not leave
  // "Exporting PDF" on screen for good.
  const deadline = new Promise<never>((_, reject) => {
    setTimeout(
      () =>
        reject(
          new Error(
            "The PDF did not finish rendering within 2 minutes. Try approving again.",
          ),
        ),
      120_000,
    ).unref?.();
  });
  try {
    await writeFile(htmlPath, html, "utf8");
    await Promise.race([exportWindow.loadFile(htmlPath), deadline]);
    await Promise.race([
      exportWindow.webContents.executeJavaScript(
        "new Promise((resolve) => { if (document.fonts?.ready) { document.fonts.ready.finally(resolve); } else { resolve(); } })",
        true,
      ),
      deadline,
    ]);

    const pdfBuffer = await Promise.race([
      exportWindow.webContents.printToPDF({
        margins: {
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
        },
        printBackground: true,
        pageSize: "Letter",
        preferCSSPageSize: true,
      }),
      deadline,
    ]);

    await writeFile(targetPath, pdfBuffer);
  } finally {
    if (!exportWindow.isDestroyed()) {
      exportWindow.destroy();
    }
  }
}

export function createLocalJobFinderDocumentManager(
  options: CreateLocalJobFinderDocumentManagerOptions,
): JobFinderDocumentManager {
  let shouldFailNextPreview = options.previewTestMode === "fail_once";

  return {
    listResumeTemplates() {
      return listLocalResumeTemplates();
    },
    renderResumePreview(input, signal) {
      throwIfPreviewAborted(signal);
      if (shouldFailNextPreview) {
        shouldFailNextPreview = false;
        throw new Error("Preview rendering failed in desktop test mode.");
      }

      const html = renderResumeTemplateHtml(input, { mode: "preview" });
      throwIfPreviewAborted(signal);

      return Promise.resolve({
        html,
        warnings: [],
      });
    },
    /**
     * Renders the letter through the same window-and-print path the resume
     * export uses, so a letter and the resume beside it are produced the same
     * way and land in the same place.
     *
     * PDF uses the same print path as resume export. DOCX is a real Office
     * Open XML package, not renamed PDF bytes.
     */
    async renderLetterArtifact(input) {
      await mkdir(options.outputDirectory, { recursive: true });
      const baseName = `${Date.now()}_${sanitizeSegment(input.profile.fullName ?? "")}_${sanitizeSegment(input.job.company)}_letter`;
      if (input.fileType === "txt") {
        const txtPath = path.join(options.outputDirectory, `${baseName}.txt`);
        await writeFile(txtPath, `${input.text.trim()}\n`, "utf8");
        const sha256 = createHash("sha256")
          .update(await readFile(txtPath))
          .digest("hex");
        return {
          ok: true,
          fileName: path.basename(txtPath),
          mimeType: "text/plain",
          storagePath: txtPath,
          sha256,
        };
      }
      if (input.fileType === "docx") {
        const docxPath = path.join(options.outputDirectory, `${baseName}.docx`);
        await writeFile(docxPath, await renderLetterDocx(input.text));
        const sha256 = createHash("sha256")
          .update(await readFile(docxPath))
          .digest("hex");
        return {
          ok: true,
          fileName: path.basename(docxPath),
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          storagePath: docxPath,
          sha256,
        };
      }
      const htmlPath = path.join(options.outputDirectory, `${baseName}.html`);
      const pdfPath = path.join(options.outputDirectory, `${baseName}.pdf`);

      await renderPdfFromHtml(
        renderLetterHtml(input.text, input.profile.fullName ?? ""),
        htmlPath,
        pdfPath,
      );
      const sha256 = createHash("sha256")
        .update(await readFile(pdfPath))
        .digest("hex");

      return {
        ok: true,
        fileName: path.basename(pdfPath),
        mimeType: "application/pdf",
        storagePath: pdfPath,
        sha256,
      };
    },
    async renderResumeArtifact(input) {
      await mkdir(options.outputDirectory, { recursive: true });

      // Parallel drafts for the same employer can render in the same millisecond.
      const artifactBaseName = `${Date.now()}_${randomUUID()}_${sanitizeSegment(input.profile.fullName ?? "")}_${sanitizeSegment(input.job.company)}_${sanitizeSegment(input.templateId)}`;
      const htmlFileName = `${artifactBaseName}.html`;
      const htmlPath = path.join(options.outputDirectory, htmlFileName);
      const html = renderResumeTemplateHtml(input);

      const requestedFormat =
        input.settings.resumeFormat === "html" ? "html" : "pdf";

      if (requestedFormat === "html") {
        const targetPath = input.targetPath ?? htmlPath;
        const fileName = path.basename(targetPath);
        await writeFile(targetPath, html, "utf8");
        const sha256 = createHash("sha256")
          .update(await readFile(targetPath))
          .digest("hex");

        return {
          fileName,
          storagePath: targetPath,
          sha256,
          format: "html",
          intermediateFileName: fileName,
          intermediateStoragePath: targetPath,
          pageCount: null,
          warnings: [],
        };
      }

      const pdfFileName = `${artifactBaseName}.pdf`;
      const pdfPath =
        input.targetPath ?? path.join(options.outputDirectory, pdfFileName);
      const outputFileName = path.basename(pdfPath);
      await renderPdfFromHtml(html, htmlPath, pdfPath);
      const pageCount = await getPdfPageCount(pdfPath);
      const sha256 = createHash("sha256")
        .update(await readFile(pdfPath))
        .digest("hex");

      return {
        fileName: outputFileName,
        storagePath: pdfPath,
        sha256,
        format: "pdf",
        intermediateFileName: htmlFileName,
        intermediateStoragePath: htmlPath,
        pageCount,
        warnings: [],
      };
    },
  };
}
