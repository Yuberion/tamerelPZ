import { useCallback, useEffect, useRef, useState } from 'react'
import { pzFileUrl } from '@shared/ipc'
import { Icon } from '@renderer/components/Icon'
import { formatBytes } from '@renderer/lib/format'

interface AudioPreviewProps {
  path: string
  size: number
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s < 10 ? '0' : ''}${s}`
}

export function AudioPreview({ path, size }: AudioPreviewProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.8)
  const [muted, setMuted] = useState(false)
  const [loop, setLoop] = useState(false)
  const [error, setError] = useState<string>()

  const src = pzFileUrl(path)
  const filename = path.split(/[/\\]/).pop() ?? ''
  const ext = filename.split('.').pop()?.toUpperCase() ?? 'AUDIO'

  // Reset state when path changes
  useEffect(() => {
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setError(undefined)
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      audioRef.current.load()
    }
  }, [path])

  const togglePlay = useCallback(() => {
    if (!audioRef.current) return
    if (playing) {
      audioRef.current.pause()
      setPlaying(false)
    } else {
      audioRef.current
        .play()
        .then(() => setPlaying(true))
        .catch((e) => {
          setError(e instanceof Error ? e.message : 'Playback failed')
          setPlaying(false)
        })
    }
  }, [playing])

  const onSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value)
    setCurrentTime(val)
    if (audioRef.current) {
      audioRef.current.currentTime = val
    }
  }

  const skip = (delta: number) => {
    if (!audioRef.current) return
    const next = Math.max(0, Math.min(duration, audioRef.current.currentTime + delta))
    audioRef.current.currentTime = next
    setCurrentTime(next)
  }

  const toggleMute = () => {
    if (!audioRef.current) return
    const next = !muted
    audioRef.current.muted = next
    setMuted(next)
  }

  const onVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value)
    setVolume(val)
    if (audioRef.current) {
      audioRef.current.volume = val
      if (val > 0 && muted) {
        audioRef.current.muted = false
        setMuted(false)
      }
    }
  }

  return (
    <div className="audio-player brackets">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        loop={loop}
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration)
        }}
        onTimeUpdate={(e) => {
          setCurrentTime(e.currentTarget.currentTime)
        }}
        onEnded={() => {
          if (!loop) setPlaying(false)
        }}
        onError={() => {
          setError('Не удалось загрузить аудиофайл или неподдерживаемый кодек')
          setPlaying(false)
        }}
      />

      <div className="audio-player__head">
        <div className="audio-player__title-group">
          <span className="audio-player__ext-badge mono">{ext}</span>
          <span className="audio-player__filename truncate" title={filename}>
            {filename}
          </span>
        </div>
        <span className="audio-player__size mono is-dim">{formatBytes(size)}</span>
      </div>

      {/* Frequency Visualizer Bars */}
      <div className={`audio-player__visualizer ${playing ? 'is-active' : ''}`}>
        {Array.from({ length: 24 }).map((_, i) => (
          <span
            key={i}
            className="audio-player__bar"
            style={{
              animationDelay: `${(i * 0.07) % 0.8}s`,
              height: playing ? undefined : '15%'
            }}
          />
        ))}
      </div>

      {/* Scrubber / Progress */}
      <div className="audio-player__scrubber-row">
        <span className="audio-player__time mono">{formatTime(currentTime)}</span>
        <input
          type="range"
          className="audio-player__range"
          min={0}
          max={duration || 100}
          step={0.1}
          value={currentTime}
          onChange={onSeek}
          disabled={!duration}
        />
        <span className="audio-player__time mono is-dim">{formatTime(duration)}</span>
      </div>

      {/* Control Buttons */}
      <div className="audio-player__controls">
        <button
          type="button"
          className="btn btn-icon btn-sm"
          onClick={() => skip(-5)}
          title="Назад на 5 сек"
          disabled={!duration}
        >
          <Icon name="arrow-left" size={13} />
        </button>

        <button
          type="button"
          className={`audio-player__play-btn ${playing ? 'is-playing' : ''}`}
          onClick={togglePlay}
          title={playing ? 'Пауза' : 'Воспроизведение'}
        >
          <Icon name={playing ? 'pause' : 'play'} size={16} />
        </button>

        <button
          type="button"
          className="btn btn-icon btn-sm"
          onClick={() => skip(5)}
          title="Вперед на 5 сек"
          disabled={!duration}
        >
          <Icon name="arrow-right" size={13} />
        </button>

        <button
          type="button"
          className={`btn btn-icon btn-sm ${loop ? 'is-active-btn' : ''}`}
          onClick={() => setLoop(!loop)}
          title={loop ? 'Зацикливание включено' : 'Включить зацикливание'}
        >
          <Icon name="refresh" size={13} />
        </button>

        <div className="audio-player__vol-group">
          <button
            type="button"
            className="btn btn-icon btn-sm"
            onClick={toggleMute}
            title={muted ? 'Включить звук' : 'Выключить звук'}
          >
            <Icon name={muted || volume === 0 ? 'eye' : 'check'} size={13} />
          </button>
          <input
            type="range"
            className="audio-player__vol-slider"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={onVolumeChange}
            title={`Громкость: ${Math.round((muted ? 0 : volume) * 100)}%`}
          />
        </div>
      </div>

      {error && (
        <div className="alert alert--warn" style={{ marginTop: 8 }}>
          <Icon name="alert" size={13} />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}
