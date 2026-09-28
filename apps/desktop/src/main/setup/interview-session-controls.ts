import { Menu, Tray, dialog, globalShortcut, nativeImage } from 'electron'
import type { InterviewHotkeyAction } from '@nordri/contracts'
import { getLiveAssistantService } from '../services/live-assistant'
import { syncInterviewOverlayWindows } from './interview-overlay-windows'

const hotkeyBindings: ReadonlyArray<{
  readonly accelerator: string
  readonly action: InterviewHotkeyAction
}> = [
  { accelerator: 'Alt+H', action: 'panic_hide' },
  { accelerator: 'Alt+Q', action: 'force_cue' },
  { accelerator: 'Alt+S', action: 'capture_screenshot' },
  { accelerator: 'Alt+T', action: 'toggle_transcript_overlay' },
  { accelerator: 'Alt+A', action: 'toggle_answer_overlay' },
  { accelerator: 'Alt+L', action: 'toggle_listening' },
  { accelerator: 'Alt+I', action: 'toggle_overlay_interaction_mode' },
]

let interviewTray: Tray | null = null

async function performInterviewAction(action: InterviewHotkeyAction) {
  const service = await getLiveAssistantService()
  const workspace = await service.performAction({ action })
  syncInterviewOverlayWindows(workspace)
}

async function endSessionWithConfirmation() {
  const result = await dialog.showMessageBox({
    type: 'question',
    buttons: ['End session', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'End Live Assistant session?',
    message: 'End the active Live Assistant session?',
    detail: 'Audio and screenshot capture actions stop, overlays close, and the session moves to post-session review.',
  })

  if (result.response === 0) {
    await performInterviewAction('end_session')
  }
}

function createTrayImage() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="7" fill="#111827"/>
      <path d="M9 11h14v3H9zM9 16h10v3H9zM9 21h7v3H9z" fill="#f6d365"/>
    </svg>
  `.trim()
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
}

function buildInterviewTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'Pause/resume listening',
      click: () => {
        void performInterviewAction('toggle_listening')
      },
    },
    {
      label: 'Force cue',
      click: () => {
        void performInterviewAction('force_cue')
      },
    },
    {
      label: 'Capture screenshot',
      click: () => {
        void performInterviewAction('capture_screenshot')
      },
    },
    { type: 'separator' },
    {
      label: 'Show/hide answer overlay',
      click: () => {
        void performInterviewAction('toggle_answer_overlay')
      },
    },
    {
      label: 'Show/hide transcript overlay',
      click: () => {
        void performInterviewAction('toggle_transcript_overlay')
      },
    },
    {
      label: 'Panic hide',
      click: () => {
        void performInterviewAction('panic_hide')
      },
    },
    { type: 'separator' },
    {
      label: 'End session...',
      click: () => {
        void endSessionWithConfirmation()
      },
    },
  ])
}

export function initializeInterviewSessionControls() {
  for (const binding of hotkeyBindings) {
    const registered = globalShortcut.register(binding.accelerator, () => {
      void performInterviewAction(binding.action)
    })

    if (!registered) {
      console.warn(`[LiveAssistant] Failed to register global hotkey ${binding.accelerator}.`)
    }
  }

  interviewTray = new Tray(createTrayImage())
  interviewTray.setToolTip('Live Assistant')
  interviewTray.setContextMenu(buildInterviewTrayMenu())
}

export function disposeInterviewSessionControls() {
  globalShortcut.unregisterAll()

  if (interviewTray) {
    interviewTray.destroy()
    interviewTray = null
  }
}
