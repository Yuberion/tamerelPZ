import { app, BrowserWindow, Menu, net, protocol, screen, shell } from 'electron'
import { join, normalize } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PZ_FILE_PREFIX, PZ_FILE_SCHEME } from '../shared/ipc'
import { registerIpc } from './ipc'
import { isPathAllowed } from './services/guard'

const isDev = Boolean(process.env['ELECTRON_RENDERER_URL'])

// A stray rejection in a filesystem walk must never take the whole app down.
process.on('uncaughtException', (error) => {
  console.error('[main] uncaught exception:', error)
})
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandled rejection:', reason)
})

protocol.registerSchemesAsPrivileged([
  {
    scheme: PZ_FILE_SCHEME,
    privileges: { supportFetchAPI: true, stream: true, bypassCSP: true, standard: false }
  }
])

/** Serve local images (mod posters/icons) without exposing the whole disk. */
function registerFileProtocol(): void {
  protocol.handle(PZ_FILE_SCHEME, async (request) => {
    if (!request.url.startsWith(PZ_FILE_PREFIX)) {
      return new Response('Bad request', { status: 400 })
    }
    let target: string
    try {
      const encoded = request.url.slice(PZ_FILE_PREFIX.length).replace(/[?#].*$/, '')
      target = normalize(Buffer.from(encoded, 'base64url').toString('utf8'))
    } catch {
      return new Response('Bad path', { status: 400 })
    }
    if (!(await isPathAllowed(target))) {
      return new Response('Forbidden', { status: 403 })
    }
    try {
      return await net.fetch(pathToFileURL(target).toString())
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

function createWindow(): BrowserWindow {
  // Never open larger than the usable desktop area, or the frameless window
  // pushes its own controls off screen on laptop displays.
  const { width: waW, height: waH } = screen.getPrimaryDisplay().workAreaSize
  const width = Math.min(1560, Math.max(960, waW - 60))
  const height = Math.min(960, Math.max(640, waH - 60))

  const win = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(1080, width),
    minHeight: Math.min(660, height),
    center: true,
    show: false,
    frame: false,
    backgroundColor: '#0e1013',
    title: 'PZ MANAGEMENT',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      webSecurity: true
    }
  })

  win.once('ready-to-show', () => win.show())

  const emitState = (): void => {
    if (!win.isDestroyed()) win.webContents.send('window:state', { maximized: win.isMaximized() })
  }
  win.on('maximize', emitState)
  win.on('unmaximize', emitState)
  win.on('enter-full-screen', emitState)
  win.on('leave-full-screen', emitState)

  // External links open in the user's browser, never in the app shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) {
      event.preventDefault()
      if (/^https?:/.test(url)) void shell.openExternal(url)
    }
  })

  // Keep devtools reachable in a frameless, menu-less window.
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown') return
    const devtools =
      input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')
    if (devtools) win.webContents.toggleDevTools()
    if (input.control && input.shift && input.key.toLowerCase() === 'r') win.webContents.reload()
  })

  // Surface renderer problems in the terminal during development.
  if (isDev) {
    win.webContents.on('console-message', (details) => {
      if (details.level === 'error' || details.level === 'warning') {
        console.log(`[renderer:${details.level}] ${details.message} (${details.lineNumber})`)
      }
    })
  }
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer gone]', details.reason)
  })
  win.webContents.on('preload-error', (_e, path, error) => {
    console.error('[preload error]', path, error)
  })

  if (isDev) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'] as string)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  void app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    app.setAppUserModelId('com.pzmanagement.app')
    registerFileProtocol()
    registerIpc()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
