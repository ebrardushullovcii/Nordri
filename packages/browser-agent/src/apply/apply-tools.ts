import type { ApplyProposal } from "./types";

/**
 * What the apply agent can do.
 *
 * This is a harness, not a form-filler on rails. The agent gets the ordinary
 * powers a person has in a browser — look, read, click anything, follow a
 * link, type, go back, wait, scroll — and is trusted to work out how a
 * particular site wants to be used. Job Finder does not decide in advance
 * which button is the Apply button, because every time it has tried, it has
 * been wrong about some site a person could have used without thinking.
 *
 * The deliberate exceptions are safety, and they are small: the answer to a
 * question comes from the person's own facts rather than the model's
 * imagination, and sending an application goes through a separate check.
 */

export const APPLY_TOOL_NAMES = [
  "observe",
  "read_text",
  "navigate",
  "follow_link",
  "click",
  "type",
  "select",
  "set_checkbox",
  "upload",
  "scroll",
  "wait",
  "go_back",
  "suggest_answer",
  "submit_application",
  "finish",
] as const;

export type ApplyToolName = (typeof APPLY_TOOL_NAMES)[number];

/** Same shape the discovery tools hand the model, so one client serves both. */
export interface ApplyToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export function getApplyToolDefinitions(): ApplyToolDefinition[] {
  return [
    {
      type: "function",
      function: {
        name: "observe",
        description:
          "Look at the whole page: its address, headings, every visible field, every button, every link with where it goes, anything else clickable, tabs the page opened, and an excerpt of the text. Nothing is filtered — what a person could see, you can see. Start here and look again whenever the page changes.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "read_text",
        description:
          "Read the full text of the page, or of one element, when the excerpt in observe was not enough.",
        parameters: {
          type: "object",
          properties: {
            ref: {
              type: "string",
              description:
                "Optional handle of one element. Omit for the whole page.",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "navigate",
        description:
          "Go to a web address. Use it for an address you read on the page, or to get back to one you saw earlier.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string" },
            reason: {
              type: "string",
              description:
                "If this leaves the site the listing is on: exactly why it serves the application, what on the page points there, and what you expect to find. A second review reads it.",
            },
          },
          required: ["url"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "follow_link",
        description:
          "Open what a link points at, in this same tab, whether or not the site wanted it in a new one. This is how you get from a job listing to the form that belongs to it, including onto a different company's site.",
        parameters: {
          type: "object",
          properties: {
            ref: { type: "string", description: "The link handle, such as l4." },
            reason: {
              type: "string",
              description:
                "If this leaves the site the listing is on: exactly why it serves the application, what on the page points there, and what you expect to find. A second review reads it.",
            },
          },
          required: ["ref"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "click",
        description:
          "Press anything on the page: a button, a link, a card, a tab, a cookie banner's Accept, the close cross on a chat widget. If a person could click it, you can.",
        parameters: {
          type: "object",
          properties: {
            ref: {
              type: "string",
              description: "Any handle from observe: a3, l7, e12, c2.",
            },
            reason: {
              type: "string",
              description:
                "If this leaves the site the listing is on: exactly why it serves the application, what on the page points there, and what you expect to find. A second review reads it.",
            },
          },
          required: ["ref"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "type",
        description:
          "Type into a field. For a question about the person, call suggest_answer first and use what it gives you; only write your own words when it has nothing and the question genuinely needs prose.",
        parameters: {
          type: "object",
          properties: {
            ref: { type: "string" },
            text: { type: "string" },
            groundedIn: {
              type: "array",
              items: { type: "string" },
              description:
                "For text you wrote yourself: what you based it on, in plain words.",
            },
          },
          required: ["ref", "text"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "select",
        description: "Choose an option in a list or dropdown.",
        parameters: {
          type: "object",
          properties: {
            ref: { type: "string" },
            option: { type: "string", description: "The option's exact label." },
          },
          required: ["ref", "option"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "set_checkbox",
        description:
          "Tick or untick a checkbox or radio. Anything the person has to declare themselves — certifying answers are true, consenting to a background check, equal-opportunity questions — is only ticked when they approved that kind in advance; otherwise it waits for them.",
        parameters: {
          type: "object",
          properties: {
            ref: { type: "string" },
            checked: { type: "boolean" },
          },
          required: ["ref", "checked"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "upload",
        description:
          "Attach one of the files Job Finder holds for this application to a file field.",
        parameters: {
          type: "object",
          properties: {
            ref: { type: "string" },
            documentId: {
              type: "string",
              description: "An id from the file list in your instructions.",
            },
          },
          required: ["ref", "documentId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "scroll",
        description:
          "Move the page, for content that only loads or appears when you scroll.",
        parameters: {
          type: "object",
          properties: {
            direction: {
              type: "string",
              enum: ["down", "up", "top", "bottom"],
            },
          },
          required: ["direction"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "wait",
        description:
          "Wait for a page that is still settling, then look again. Use it sparingly.",
        parameters: {
          type: "object",
          properties: {
            milliseconds: { type: "number", description: "Up to 30000. A page checking the browser by itself can take a minute or two: wait 20000 to 30000 at a time." },
          },
          required: ["milliseconds"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "go_back",
        description: "Go back, when a link turned out to be the wrong way.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "suggest_answer",
        description:
          "Ask what the person's own profile, the resume going out with this application, and their saved answers say about one field. Returns the answer and where it came from, or says there is nothing — in which case either write the answer yourself if it is a prose question, or finish and say this question needs them.",
        parameters: {
          type: "object",
          properties: { ref: { type: "string" } },
          required: ["ref"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "submit_application",
        description:
          "Say the form is complete and this is the button that sends it. Job Finder checks everything again and presses it only if the person allowed that; otherwise the application stops here, filled in and ready for them.",
        parameters: {
          type: "object",
          properties: { ref: { type: "string" } },
          required: ["ref"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "finish",
        description:
          "Finish. Call it when the form is complete, when only the person can go further (they have to sign in, pass a security check, pay, or make an account), or when you are genuinely stuck. The reason is your report to the person: which site and page you were on, what you tried, what the page did, and what they need to do. Pass stuck: true when you could not get there.",
        parameters: {
          type: "object",
          properties: {
            reason: {
              type: "string",
              description: "Why you are finishing, in one plain sentence.",
            },
            stuck: { type: "boolean" },
            needsPerson: {
              type: "boolean",
              description:
                "true when the person has to do something on the site before this can go further.",
            },
          },
          required: ["reason"],
        },
      },
    },
  ];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const values = value.filter(
    (entry): entry is string => typeof entry === "string",
  );
  return values.length > 0 ? values : null;
}

export type ApplyProposalParse =
  | { ok: true; proposal: ApplyProposal }
  | { ok: false; error: string };

/** Turns one model tool call into a proposal, or says plainly what was wrong. */
export function parseApplyProposal(
  toolName: string,
  rawArguments: string,
): ApplyProposalParse {
  let parsedArguments: unknown = {};
  if (rawArguments.trim().length > 0) {
    try {
      parsedArguments = JSON.parse(rawArguments);
    } catch {
      return {
        ok: false,
        error: `The arguments for ${toolName} were not valid JSON.`,
      };
    }
  }
  const args = asRecord(parsedArguments);
  const ref = asString(args.ref);
  const reason = asString(args.reason);
  const withReason = <T extends object>(proposal: T): T & { reason?: string } =>
    reason ? { ...proposal, reason } : proposal;
  const needsRef = (): ApplyProposalParse => ({
    ok: false,
    error: `${toolName} needs the handle of what to act on, in ref.`,
  });

  switch (toolName) {
    case "observe":
      return { ok: true, proposal: { tool: "observe" } };
    case "read_text":
      return {
        ok: true,
        proposal: { tool: "read_text", ...(ref ? { ref } : {}) },
      };
    case "navigate": {
      const url = asString(args.url);
      return url
        ? { ok: true, proposal: withReason({ tool: "navigate" as const, url }) }
        : { ok: false, error: "navigate needs a url." };
    }
    case "follow_link":
      return ref
        ? { ok: true, proposal: withReason({ tool: "follow_link" as const, ref }) }
        : needsRef();
    case "click":
      return ref
        ? { ok: true, proposal: withReason({ tool: "click" as const, ref }) }
        : needsRef();
    case "type": {
      if (!ref) return needsRef();
      const text = asString(args.text);
      if (text === null) {
        return { ok: false, error: "type needs the text to put in the field." };
      }
      const groundedIn = asStringArray(args.groundedIn);
      return {
        ok: true,
        proposal: {
          tool: "type",
          ref,
          text,
          ...(groundedIn ? { groundedIn } : {}),
        },
      };
    }
    case "select": {
      if (!ref) return needsRef();
      const option = asString(args.option);
      return option
        ? { ok: true, proposal: { tool: "select", ref, option } }
        : { ok: false, error: "select needs the option's label." };
    }
    case "set_checkbox":
      return ref
        ? {
            ok: true,
            proposal: {
              tool: "set_checkbox",
              ref,
              checked: args.checked !== false,
            },
          }
        : needsRef();
    case "upload": {
      if (!ref) return needsRef();
      const documentId = asString(args.documentId);
      return documentId
        ? { ok: true, proposal: { tool: "upload", ref, documentId } }
        : { ok: false, error: "upload needs a documentId." };
    }
    case "scroll": {
      const direction = asString(args.direction) ?? "down";
      return ["down", "up", "top", "bottom"].includes(direction)
        ? {
            ok: true,
            proposal: {
              tool: "scroll",
              direction: direction as "down" | "up" | "top" | "bottom",
            },
          }
        : { ok: false, error: "scroll takes down, up, top, or bottom." };
    }
    case "wait": {
      const milliseconds =
        typeof args.milliseconds === "number" ? args.milliseconds : 1_000;
      return { ok: true, proposal: { tool: "wait", milliseconds } };
    }
    case "go_back":
      return { ok: true, proposal: { tool: "go_back" } };
    case "suggest_answer":
      return ref
        ? { ok: true, proposal: { tool: "suggest_answer", ref } }
        : needsRef();
    case "submit_application":
      return ref
        ? { ok: true, proposal: { tool: "submit_application", ref } }
        : needsRef();
    case "finish": {
      const reason = asString(args.reason) ?? "Finished without saying why.";
      return {
        ok: true,
        proposal: {
          tool: "finish",
          reason,
          stuck: args.stuck === true,
          needsPerson: args.needsPerson === true,
        },
      };
    }
    default:
      return { ok: false, error: `There is no tool called ${toolName}.` };
  }
}
