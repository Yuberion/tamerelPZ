import { useEffect, useRef, useState } from 'react'
import type { MeshPreviewData } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { formatBytes, formatCount } from '@renderer/lib/format'

interface MeshPreviewProps {
  path: string
  name?: string
  size?: number
}

// Minimal 4x4 matrix helpers
function mat4Identity(): Float32Array {
  const m = new Float32Array(16)
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1
  return m
}

function mat4Perspective(fovyRad: number, aspect: number, near: number, far: number): Float32Array {
  const m = new Float32Array(16)
  const f = 1.0 / Math.tan(fovyRad / 2)
  m[0] = f / aspect
  m[5] = f
  m[10] = (far + near) / (near - far)
  m[11] = -1
  m[14] = (2 * far * near) / (near - far)
  return m
}

function mat4Multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16)
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + r] * b[c * 4 + k]
      }
      out[c * 4 + r] = sum
    }
  }
  return out
}

export function MeshPreview({ path, name, size }: MeshPreviewProps) {
  const displayName = name || path.split(/[/\\]/).pop() || 'model'
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const canvasBoxRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [data, setData] = useState<MeshPreviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [wireframe, setWireframe] = useState(false)
  const [autoRotate, setAutoRotate] = useState(true)
  const [showTexture, setShowTexture] = useState(true)
  const [flipV, setFlipV] = useState(false)
  const [cutout, setCutout] = useState(false)
  const [customTextureUrl, setCustomTextureUrl] = useState<string | null>(null)
  const [customTextureName, setCustomTextureName] = useState<string | null>(null)

  // Camera orbit state
  const rotRef = useRef({ x: 0.35, y: 0.75 })
  const zoomRef = useRef(2.5)
  const panRef = useRef({ x: 0, y: 0 })
  const dragRef = useRef<{ startX: number; startY: number; button: number } | null>(null)

  // Reset custom texture on model path change
  useEffect(() => {
    setCustomTextureUrl(null)
    setCustomTextureName(null)
    setCutout(false)
  }, [path])

  // Release WebGL hardware context on unmount to prevent Chromium context limit exhaustion
  useEffect(() => {
    return () => {
      if (canvasRef.current) {
        const gl =
          (canvasRef.current.getContext('webgl2') as WebGLRenderingContext | null) ||
          (canvasRef.current.getContext('webgl') as WebGLRenderingContext | null)
        if (gl) {
          gl.getExtension('WEBGL_lose_context')?.loseContext()
        }
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setData(null)

    window.pz.fs
      .meshPreview(path)
      .then((res) => {
        if (cancelled) return
        if (res.ok) {
          setData(res)
        } else {
          setError(res.error || 'Failed to parse 3D mesh')
        }
      })
      .catch((err) => {
        console.error('[MeshPreview] meshPreview error:', err)
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [path])

  const activeTextureUrl = customTextureUrl || data?.textureUrl || null
  const activeTextureName = customTextureName || data?.textureName || null

  // WebGL Render loop
  useEffect(() => {
    if (!data || !data.positions.length || !canvasRef.current) return

    const canvas = canvasRef.current
    const gl =
      (canvas.getContext('webgl2', { antialias: true, alpha: true }) as WebGLRenderingContext | null) ||
      canvas.getContext('webgl', { antialias: true, alpha: true })
    if (!gl) return

    // Calculate bounding box and normalize positions to [-1, 1]
    const rawPos = data.positions
    let minX = Infinity, minY = Infinity, minZ = Infinity
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity

    for (let i = 0; i < rawPos.length; i += 3) {
      const x = rawPos[i]
      const y = rawPos[i + 1]
      const z = rawPos[i + 2]
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }

    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    const centerZ = (minZ + maxZ) / 2
    const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 0.0001)
    const scale = 1.8 / span

    const normalizedPos = new Float32Array(rawPos.length)
    for (let i = 0; i < rawPos.length; i += 3) {
      normalizedPos[i] = (rawPos[i] - centerX) * scale
      normalizedPos[i + 1] = (rawPos[i + 1] - centerY) * scale
      normalizedPos[i + 2] = (rawPos[i + 2] - centerZ) * scale
    }

    // Build flat face normals if not provided
    const hasNormals = data.normals.length === rawPos.length
    const normalBuf = new Float32Array(rawPos.length)

    if (hasNormals) {
      normalBuf.set(data.normals)
    } else {
      for (let i = 0; i < normalizedPos.length; i += 9) {
        const ax = normalizedPos[i], ay = normalizedPos[i + 1], az = normalizedPos[i + 2]
        const bx = normalizedPos[i + 3], by = normalizedPos[i + 4], bz = normalizedPos[i + 5]
        const cx = normalizedPos[i + 6], cy = normalizedPos[i + 7], cz = normalizedPos[i + 8]

        const u1 = bx - ax, u2 = by - ay, u3 = bz - az
        const v1 = cx - ax, v2 = cy - ay, v3 = cz - az

        let nx = u2 * v3 - u3 * v2
        let ny = u3 * v1 - u1 * v3
        let nz = u1 * v2 - u2 * v1
        const len = Math.hypot(nx, ny, nz) || 1
        nx /= len; ny /= len; nz /= len

        for (let v = 0; v < 3; v++) {
          normalBuf[i + v * 3] = nx
          normalBuf[i + v * 3 + 1] = ny
          normalBuf[i + v * 3 + 2] = nz
        }
      }
    }

    // UV coordinates buffer
    const vertCount = normalizedPos.length / 3
    const uvBuf = new Float32Array(vertCount * 2)
    if (data.uvs && data.uvs.length >= vertCount * 2) {
      for (let i = 0; i < vertCount * 2; i++) {
        uvBuf[i] = data.uvs[i]
      }
    }

    // Shader sources
    const vsSource = `
      attribute vec3 aPos;
      attribute vec3 aNormal;
      attribute vec2 aUv;
      uniform mat4 uMvp;
      uniform mat4 uModel;
      varying vec3 vNormal;
      varying vec3 vPos;
      varying vec2 vUv;
      void main() {
        vNormal = mat3(uModel) * aNormal;
        vPos = (uModel * vec4(aPos, 1.0)).xyz;
        vUv = aUv;
        gl_Position = uMvp * vec4(aPos, 1.0);
      }
    `
    const fsSource = `
      precision mediump float;
      varying vec3 vNormal;
      varying vec3 vPos;
      varying vec2 vUv;
      uniform int uWire;
      uniform vec3 uColor;
      uniform sampler2D uTexture;
      uniform int uHasTexture;
      uniform int uFlipV;
      uniform int uCutout;
      void main() {
        if (uWire == 1) {
          gl_FragColor = vec4(0.95, 0.65, 0.25, 1.0);
          return;
        }
        vec3 n = normalize(vNormal);
        if (!gl_FrontFacing) n = -n;
        vec3 l1 = normalize(vec3(0.6, 0.9, 0.8));
        vec3 l2 = normalize(vec3(-0.8, -0.4, -0.6));
        float d1 = max(dot(n, l1), 0.0);
        float d2 = max(dot(n, l2), 0.0) * 0.4;
        vec4 baseCol = vec4(uColor, 1.0);
        if (uHasTexture == 1) {
          vec2 uv = uFlipV == 1 ? vec2(vUv.x, 1.0 - vUv.y) : vUv;
          vec4 texCol = texture2D(uTexture, uv);
          if (uCutout == 1 && texCol.a < 0.1) discard;
          baseCol = vec4(texCol.rgb, 1.0);
        }
        vec3 col = baseCol.rgb * (d1 + d2 + 0.38);
        gl_FragColor = vec4(col, 1.0);
      }
    `

    function createShader(type: number, src: string) {
      const s = gl!.createShader(type)!
      gl!.shaderSource(s, src)
      gl!.compileShader(s)
      return s
    }

    const vs = createShader(gl.VERTEX_SHADER, vsSource)
    const fs = createShader(gl.FRAGMENT_SHADER, fsSource)
    const prog = gl.createProgram()!
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    gl.useProgram(prog)

    // Initial viewport setup
    const rect = canvasBoxRef.current?.getBoundingClientRect()
    const initW = Math.max(1, Math.floor(canvas.clientWidth || rect?.width || 380))
    const initH = Math.max(1, Math.floor(canvas.clientHeight || rect?.height || 280))
    canvas.width = initW
    canvas.height = initH
    gl.viewport(0, 0, initW, initH)

    // Buffers
    const posBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, normalizedPos, gl.STATIC_DRAW)

    const normBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, normBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, normalBuf, gl.STATIC_DRAW)

    const uvBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, uvBuf, gl.STATIC_DRAW)

    const aPosLoc = gl.getAttribLocation(prog, 'aPos')
    const aNormLoc = gl.getAttribLocation(prog, 'aNormal')
    const aUvLoc = gl.getAttribLocation(prog, 'aUv')
    const uMvpLoc = gl.getUniformLocation(prog, 'uMvp')
    const uModelLoc = gl.getUniformLocation(prog, 'uModel')
    const uWireLoc = gl.getUniformLocation(prog, 'uWire')
    const uColorLoc = gl.getUniformLocation(prog, 'uColor')
    const uTextureLoc = gl.getUniformLocation(prog, 'uTexture')
    const uHasTextureLoc = gl.getUniformLocation(prog, 'uHasTexture')
    const uFlipVLoc = gl.getUniformLocation(prog, 'uFlipV')
    const uCutoutLoc = gl.getUniformLocation(prog, 'uCutout')

    // Bind default fallback 1x1 white texture to TEXTURE0 immediately
    const defaultTex = gl.createTexture()
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, defaultTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([220, 220, 220, 255]))

    // WebGL Texture loading
    let glTex: WebGLTexture | null = null
    let textureReady = false

    if (activeTextureUrl) {
      const img = new Image()
      if (!activeTextureUrl.startsWith('data:')) {
        img.crossOrigin = 'anonymous'
      }
      img.onload = () => {
        if (!gl || !canvasRef.current) return
        glTex = gl.createTexture()
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, glTex)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)

        const isPot = (img.width & (img.width - 1)) === 0 && (img.height & (img.height - 1)) === 0
        if (isPot) {
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
          gl.generateMipmap(gl.TEXTURE_2D)
        } else {
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
        }
        textureReady = true
      }
      img.onerror = (err) => {
        console.warn('[MeshPreview] Failed to load texture image:', err)
      }
      img.src = activeTextureUrl
    }

    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)

    let animId = 0
    let lastTime = performance.now()

    function render(now: number) {
      if (!canvas || !gl) return
      const dt = (now - lastTime) / 1000
      lastTime = now

      if (autoRotate && !dragRef.current) {
        rotRef.current.y += dt * 0.6
      }

      // Handle resize with safe non-zero bounds
      const boxRect = canvasBoxRef.current?.getBoundingClientRect()
      const rawW = canvas.clientWidth || (boxRect ? Math.floor(boxRect.width) : 0)
      const rawH = canvas.clientHeight || (boxRect ? Math.floor(boxRect.height) : 0)
      const width = Math.max(1, rawW)
      const height = Math.max(1, rawH)
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
        gl.viewport(0, 0, width, height)
      }

      gl.clearColor(0.06, 0.08, 0.11, 1.0)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

      // Model matrix (Rotation + Pan)
      const cx = Math.cos(rotRef.current.x)
      const sx = Math.sin(rotRef.current.x)
      const cy = Math.cos(rotRef.current.y)
      const sy = Math.sin(rotRef.current.y)

      const model = mat4Identity()
      model[0] = cy; model[2] = -sy
      model[8] = sy; model[10] = cy

      const rotX = mat4Identity()
      rotX[5] = cx; rotX[6] = sx
      rotX[9] = -sx; rotX[10] = cx
      const rotated = mat4Multiply(rotX, model)

      // View matrix
      const view = mat4Identity()
      view[12] = panRef.current.x
      view[13] = panRef.current.y
      view[14] = -zoomRef.current

      // Projection
      const aspect = (canvas.width || 1) / (canvas.height || 1)
      const proj = mat4Perspective(Math.PI / 4, aspect, 0.1, 100.0)

      const mv = mat4Multiply(view, rotated)
      const mvp = mat4Multiply(proj, mv)

      gl.uniformMatrix4fv(uMvpLoc, false, mvp)
      gl.uniformMatrix4fv(uModelLoc, false, rotated)
      gl.uniform1i(uWireLoc, wireframe ? 1 : 0)
      gl.uniform3f(uColorLoc, 0.78, 0.82, 0.88)
      gl.uniform1i(uFlipVLoc, flipV ? 1 : 0)
      gl.uniform1i(uCutoutLoc, cutout ? 1 : 0)

      if (showTexture && textureReady && glTex) {
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, glTex)
        gl.uniform1i(uTextureLoc, 0)
        gl.uniform1i(uHasTextureLoc, 1)
      } else {
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, defaultTex)
        gl.uniform1i(uTextureLoc, 0)
        gl.uniform1i(uHasTextureLoc, 0)
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer)
      gl.enableVertexAttribArray(aPosLoc)
      gl.vertexAttribPointer(aPosLoc, 3, gl.FLOAT, false, 0, 0)

      gl.bindBuffer(gl.ARRAY_BUFFER, normBuffer)
      gl.enableVertexAttribArray(aNormLoc)
      gl.vertexAttribPointer(aNormLoc, 3, gl.FLOAT, false, 0, 0)

      if (aUvLoc !== -1) {
        gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer)
        gl.enableVertexAttribArray(aUvLoc)
        gl.vertexAttribPointer(aUvLoc, 2, gl.FLOAT, false, 0, 0)
      }

      if (wireframe) {
        gl.drawArrays(gl.LINES, 0, vertCount)
      } else {
        gl.drawArrays(gl.TRIANGLES, 0, vertCount)
      }

      animId = requestAnimationFrame(render)
    }

    animId = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(animId)
      if (gl) {
        gl.deleteBuffer(posBuffer)
        gl.deleteBuffer(normBuffer)
        gl.deleteBuffer(uvBuffer)
        if (glTex) gl.deleteTexture(glTex)
        if (defaultTex) gl.deleteTexture(defaultTex)
        gl.deleteProgram(prog)
      }
    }
  }, [data, wireframe, autoRotate, showTexture, flipV, cutout, activeTextureUrl])

  // Mouse interaction handlers
  const onMouseDown = (e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, button: e.button }
  }

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    dragRef.current.startX = e.clientX
    dragRef.current.startY = e.clientY

    if (dragRef.current.button === 0) {
      rotRef.current.y += dx * 0.012
      rotRef.current.x = Math.max(-1.5, Math.min(1.5, rotRef.current.x + dy * 0.012))
    } else if (dragRef.current.button === 2) {
      panRef.current.x += dx * 0.003
      panRef.current.y -= dy * 0.003
    }
  }

  const onMouseUp = () => {
    dragRef.current = null
  }

  // Non-passive wheel handler to prevent scroll without browser warning
  useEffect(() => {
    const box = canvasBoxRef.current
    if (!box) return
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      zoomRef.current = Math.max(0.6, Math.min(8.0, zoomRef.current + e.deltaY * 0.003))
    }
    box.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      box.removeEventListener('wheel', handleWheel)
    }
  }, [])

  const resetCamera = () => {
    rotRef.current = { x: 0.35, y: 0.75 }
    zoomRef.current = 2.5
    panRef.current = { x: 0, y: 0 }
  }

  const handlePickLocalTexture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCustomTextureUrl(reader.result)
        setCustomTextureName(file.name)
        setShowTexture(true)
      }
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="mesh-preview">
      {/* 3D Viewport Toolbar */}
      <div className="mesh-preview__toolbar">
        <div className="mesh-preview__tags">
          <span className="badge badge--dark mono">.{displayName.split('.').pop()?.toUpperCase()}</span>
          {size !== undefined && size > 0 && (
            <span className="mono is-dim" style={{ fontSize: '11px' }}>
              {formatBytes(size)}
            </span>
          )}
          {data && (
            <>
              <span className="mono" style={{ fontSize: '11px', color: 'var(--rust-hot)' }}>
                ▲ {formatCount(data.triangleCount)}
              </span>
              <span className="mono is-dim" style={{ fontSize: '11px' }}>
                ● {formatCount(data.vertexCount)}
              </span>
            </>
          )}
        </div>

        <div className="mesh-preview__actions">
          {/* Attached or custom Texture Button */}
          {activeTextureName ? (
            <button
              type="button"
              className={`btn btn--tiny ${showTexture ? 'is-active' : ''}`}
              onClick={() => setShowTexture((v) => !v)}
              title={showTexture ? `Текстура включена: ${activeTextureName} (клик для отключения)` : `Включить текстуру: ${activeTextureName}`}
            >
              <Icon name="image" size={11} />
              <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {activeTextureName}
              </span>
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--tiny is-dim"
              onClick={() => fileInputRef.current?.click()}
              title="Текстура не найдена автоматически. Нажмите, чтобы выбрать текстуру вручную"
            >
              <Icon name="image" size={11} />
              <span>+ Текстура</span>
            </button>
          )}

          {/* Flip UV toggle */}
          {activeTextureName && showTexture && (
            <button
              type="button"
              className={`btn btn--tiny ${flipV ? 'is-active' : ''}`}
              onClick={() => setFlipV((v) => !v)}
              title="Отразить координаты текстуры по вертикали (Flip V)"
            >
              <Icon name="sort" size={11} />
              <span>Flip V</span>
            </button>
          )}

          {/* Cutout toggle */}
          {activeTextureName && showTexture && (
            <button
              type="button"
              className={`btn btn--tiny ${cutout ? 'is-active' : ''}`}
              onClick={() => setCutout((v) => !v)}
              title="Альфа-тест для прозрачной листвы и волос (Cutout)"
            >
              <Icon name="filter" size={11} />
              <span>Cutout</span>
            </button>
          )}

          {/* Change Texture File */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".png,.jpg,.jpeg,.webp,.tga,.dds"
            style={{ display: 'none' }}
            onChange={handlePickLocalTexture}
          />
          {activeTextureName && (
            <button
              type="button"
              className="btn btn--tiny"
              onClick={() => fileInputRef.current?.click()}
              title="Сменить текстуру (выбрать файл с диска)"
            >
              <Icon name="folder-open" size={11} />
            </button>
          )}

          <button
            type="button"
            className={`btn btn--tiny ${wireframe ? 'is-active' : ''}`}
            onClick={() => setWireframe((v) => !v)}
            title="Переключить сетку (Wireframe)"
          >
            <Icon name="grid" size={11} />
            <span>Сетка</span>
          </button>
          <button
            type="button"
            className={`btn btn--tiny ${autoRotate ? 'is-active' : ''}`}
            onClick={() => setAutoRotate((v) => !v)}
            title="Авто-вращение камеры"
          >
            <Icon name="rotate" size={11} />
            <span>Вращение</span>
          </button>
          <button
            type="button"
            className="btn btn--tiny"
            onClick={resetCamera}
            title="Сбросить положение камеры"
          >
            <Icon name="refresh" size={11} />
          </button>
        </div>
      </div>

      {/* 3D Canvas Box */}
      <div
        ref={canvasBoxRef}
        className="mesh-preview__canvas-box"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        {loading && (
          <div className="mesh-preview__loading">
            <Icon name="refresh" size={18} className="spin" />
            <span>Загрузка 3D-модели…</span>
          </div>
        )}

        {error && (
          <div className="mesh-preview__error alert alert--bad">
            <Icon name="alert" size={14} />
            <span>{error}</span>
          </div>
        )}

        <canvas
          ref={canvasRef}
          className="mesh-preview__canvas"
          style={{
            opacity: loading || error ? 0 : 1,
            pointerEvents: loading || error ? 'none' : 'auto',
            transition: 'opacity 0.2s ease'
          }}
        />

        <div className="mesh-preview__hint is-dim">
          <span>ЛКМ — вращение · ПКМ — смещение · Колесо — зум</span>
        </div>
      </div>
    </div>
  )
}
