import { useMemo, useState } from 'react'
import type { LoadoutFile, MLOSCategory, ModEntry, ModOverwritesSummary } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { useToast } from '@renderer/components/Toast'
import { useI18n } from '@renderer/i18n'
import { copyText, formatCount } from '@renderer/lib/format'
import { bareId } from './useLoadout'
import { isSeparator } from './OrderList'
import { detectMlosCategory, CATEGORY_META } from './mlos'

interface BuildReportModalProps {
  activeList: string[]
  byModId: Map<string, ModEntry>
  targetFile?: LoadoutFile
  overwritesSummary?: ModOverwritesSummary
  onClose(): void
}

type ReportFormat = 'discord' | 'steam' | 'markdown' | 'server'

export function BuildReportModal({
  activeList,
  byModId,
  targetFile,
  overwritesSummary,
  onClose
}: BuildReportModalProps) {
  const { lang } = useI18n()
  const isRu = lang === 'ru'
  const { notify } = useToast()

  const [format, setFormat] = useState<ReportFormat>('discord')
  const [groupByCategory, setGroupByCategory] = useState(true)
  const [includeLinks, setIncludeLinks] = useState(true)
  const [includeStats, setIncludeStats] = useState(true)

  // Clean mods list
  const { modsList, categoryBuckets, mapNames, workshopIds } = useMemo(() => {
    const modsList: ModEntry[] = []
    const mapNames: string[] = []
    const workshopIds: string[] = []
    const categoryBuckets = new Map<MLOSCategory, ModEntry[]>()

    const seenWorkshop = new Set<string>()

    for (const raw of activeList) {
      if (isSeparator(raw)) {
        continue
      }
      const bare = bareId(raw)
      const mod = byModId.get(bare)
      if (mod) {
        modsList.push(mod)
        const cat = detectMlosCategory(mod)
        if (!categoryBuckets.has(cat)) {
          categoryBuckets.set(cat, [])
        }
        categoryBuckets.get(cat)!.push(mod)

        if (mod.workshopId && !seenWorkshop.has(mod.workshopId)) {
          seenWorkshop.add(mod.workshopId)
          workshopIds.push(mod.workshopId)
        }

        // Collect maps if folder has maps
        if (mod.mediaDirs.some((d) => d.toLowerCase().includes('maps'))) {
          mapNames.push(mod.name)
        }
      }
    }

    return { modsList, categoryBuckets, mapNames, workshopIds }
  }, [activeList, byModId])

  // Generate Report Text
  const reportText = useMemo(() => {
    const totalCount = modsList.length
    const title = targetFile?.serverName
      ? `Project Zomboid Server: ${targetFile.serverName}`
      : targetFile?.saveName
      ? `Project Zomboid Save: ${targetFile.saveName}`
      : isRu
      ? 'Сборка модов Project Zomboid'
      : 'Project Zomboid Modpack'

    // DISCORD FORMAT
    if (format === 'discord') {
      const lines: string[] = []
      lines.push(`### 🧟 ${title}`)
      if (includeStats) {
        lines.push(`> 📦 **${isRu ? 'Всего модов' : 'Total Mods'}:** \`${totalCount}\``)
        if (workshopIds.length > 0) {
          lines.push(`> 🌐 **Workshop Items:** \`${workshopIds.length}\``)
        }
        if (overwritesSummary && overwritesSummary.collisions.length > 0) {
          lines.push(`> ⚡ **${isRu ? 'Файловых коллизий' : 'File collisions'}:** \`${overwritesSummary.collisions.length}\``)
        }
        lines.push('')
      }

      if (groupByCategory) {
        for (const [cat, items] of categoryBuckets.entries()) {
          const meta = (CATEGORY_META as Record<string, { labelEn: string; labelRu: string }>)[cat] ?? CATEGORY_META.undefined
          const catLabel = isRu ? meta.labelRu : meta.labelEn
          lines.push(`**${catLabel}** (${items.length}):`)
          items.forEach((m, idx) => {
            const link = m.workshopId && includeLinks
              ? ` [Steam](<https://steamcommunity.com/sharedfiles/filedetails/?id=${m.workshopId}>)`
              : ''
            lines.push(`${idx + 1}. **${m.name}** (\`${m.modId ?? m.folderName}\`)${link}`)
          })
          lines.push('')
        }
      } else {
        lines.push(`**${isRu ? 'Список модов' : 'Mod List'}:**`)
        modsList.forEach((m, idx) => {
          const link = m.workshopId && includeLinks
            ? ` [Steam](<https://steamcommunity.com/sharedfiles/filedetails/?id=${m.workshopId}>)`
            : ''
          lines.push(`${idx + 1}. **${m.name}** (\`${m.modId ?? m.folderName}\`)${link}`)
        })
        lines.push('')
      }

      if (mapNames.length > 0) {
        lines.push(`#### 🗺️ ${isRu ? 'Порядок карт (для Map=)' : 'Map Order (for Map=)'}:`)
        lines.push('```')
        lines.push(mapNames.join(';'))
        lines.push('```')
      }

      if (workshopIds.length > 0) {
        lines.push(`#### 🆔 WorkshopItems:`)
        lines.push('```')
        lines.push(workshopIds.join(';'))
        lines.push('```')
      }

      return lines.join('\n')
    }

    // STEAM BBCODE FORMAT
    if (format === 'steam') {
      const lines: string[] = []
      lines.push(`[h1]${title}[/h1]`)
      if (includeStats) {
        lines.push(`[b]${isRu ? 'Всего модов' : 'Total Mods'}:[/b] ${totalCount}`)
        lines.push(`[b]Workshop Items:[/b] ${workshopIds.length}`)
        lines.push('[hr][/hr]')
      }

      if (groupByCategory) {
        for (const [cat, items] of categoryBuckets.entries()) {
          const meta = (CATEGORY_META as Record<string, { labelEn: string; labelRu: string }>)[cat] ?? CATEGORY_META.undefined
          const catLabel = isRu ? meta.labelRu : meta.labelEn
          lines.push(`[b]${catLabel} (${items.length}):[/b]`)
          lines.push('[list]')
          items.forEach((m) => {
            const title = m.workshopId && includeLinks
              ? `[url=https://steamcommunity.com/sharedfiles/filedetails/?id=${m.workshopId}]${m.name}[/url]`
              : m.name
            lines.push(`[*] ${title} [i](${m.modId ?? m.folderName})[/i]`)
          })
          lines.push('[/list]')
          lines.push('')
        }
      } else {
        lines.push('[list]')
        modsList.forEach((m) => {
          const title = m.workshopId && includeLinks
            ? `[url=https://steamcommunity.com/sharedfiles/filedetails/?id=${m.workshopId}]${m.name}[/url]`
            : m.name
          lines.push(`[*] ${title} [i](${m.modId ?? m.folderName})[/i]`)
        })
        lines.push('[/list]')
      }

      return lines.join('\n')
    }

    // MARKDOWN FORMAT
    if (format === 'markdown') {
      const lines: string[] = []
      lines.push(`# ${title}\n`)
      if (includeStats) {
        lines.push(`- **${isRu ? 'Всего модов' : 'Total Mods'}:** ${totalCount}`)
        lines.push(`- **Workshop Items:** ${workshopIds.length}`)
        lines.push('')
      }

      if (groupByCategory) {
        for (const [cat, items] of categoryBuckets.entries()) {
          const meta = (CATEGORY_META as Record<string, { labelEn: string; labelRu: string }>)[cat] ?? CATEGORY_META.undefined
          const catLabel = isRu ? meta.labelRu : meta.labelEn
          lines.push(`### ${catLabel} (${items.length})\n`)
          lines.push('| # | Mod Name | Mod ID | Workshop |')
          lines.push('|---|---|---|---|')
          items.forEach((m, idx) => {
            const wsLink = m.workshopId
              ? `[${m.workshopId}](https://steamcommunity.com/sharedfiles/filedetails/?id=${m.workshopId})`
              : '—'
            lines.push(`| ${idx + 1} | **${m.name}** | \`${m.modId ?? m.folderName}\` | ${wsLink} |`)
          })
          lines.push('')
        }
      } else {
        lines.push('| # | Mod Name | Mod ID | Workshop |')
        lines.push('|---|---|---|---|')
        modsList.forEach((m, idx) => {
          const wsLink = m.workshopId
            ? `[${m.workshopId}](https://steamcommunity.com/sharedfiles/filedetails/?id=${m.workshopId})`
            : '—'
          lines.push(`| ${idx + 1} | **${m.name}** | \`${m.modId ?? m.folderName}\` | ${wsLink} |`)
        })
      }

      return lines.join('\n')
    }

    // SERVER CONFIG FORMAT
    if (format === 'server') {
      const lines: string[] = []
      lines.push('# ====================================================================')
      lines.push(`# Project Zomboid Server Configuration Snippet`)
      lines.push(`# Target: ${title}`)
      lines.push(`# Total Active Mods: ${totalCount}`)
      lines.push(`# Generated by PZ Management`)
      lines.push('# ====================================================================\n')

      lines.push('# Paste this into your server .ini file:\n')
      lines.push(`Mods=${modsList.map((m) => m.modId ?? m.folderName).join(';')}\n`)
      if (mapNames.length > 0) {
        lines.push(`Map=${mapNames.join(';')};Muldraugh, KY\n`)
      }
      if (workshopIds.length > 0) {
        lines.push(`WorkshopItems=${workshopIds.join(';')}\n`)
      }

      return lines.join('\n')
    }

    return ''
  }, [format, groupByCategory, includeLinks, includeStats, modsList, categoryBuckets, workshopIds, mapNames, targetFile, overwritesSummary, isRu])

  const handleCopy = async (): Promise<void> => {
    await copyText(reportText)
    notify(isRu ? 'Отчет успешно скопирован в буфер обмена!' : 'Report copied to clipboard!', 'ok')
  }

  const handleDownload = (): void => {
    const ext = format === 'markdown' ? 'md' : format === 'server' ? 'ini' : 'txt'
    const blob = new Blob([reportText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pz_loadout_report.${ext}`
    a.click()
    URL.revokeObjectURL(url)
    notify(isRu ? 'Файл отчета сохранен' : 'Report file downloaded', 'ok')
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal lomodal lomodal--report" onClick={(e) => e.stopPropagation()}>
        {/* Head */}
        <div className="lomodal__head">
          <Icon name="book" size={15} color="var(--rust)" />
          <span className="lomodal__title stencil">
            {isRu ? 'Отчет сборки / Экспорт списка' : 'Build Report & Modpack Share'}
          </span>
          <span className="lomodal__badge mono">
            {formatCount(modsList.length)} {isRu ? 'модов' : 'mods'}
          </span>
          <div className="toolbar__spacer" />
          <button className="btn btn-icon" onClick={onClose} title={isRu ? 'Закрыть' : 'Close'}>
            <Icon name="close" size={12} />
          </button>
        </div>

        {/* Tabs */}
        <div className="loreport-tabs">
          <button
            className={`loreport-tab ${format === 'discord' ? 'is-active' : ''}`}
            onClick={() => setFormat('discord')}
          >
            <Icon name="radio" size={12} />
            Discord Markdown
          </button>
          <button
            className={`loreport-tab ${format === 'steam' ? 'is-active' : ''}`}
            onClick={() => setFormat('steam')}
          >
            <Icon name="globe" size={12} />
            Steam BBCode
          </button>
          <button
            className={`loreport-tab ${format === 'markdown' ? 'is-active' : ''}`}
            onClick={() => setFormat('markdown')}
          >
            <Icon name="file" size={12} />
            GitHub Markdown
          </button>
          <button
            className={`loreport-tab ${format === 'server' ? 'is-active' : ''}`}
            onClick={() => setFormat('server')}
          >
            <Icon name="server" size={12} />
            Server.ini Snippet
          </button>
        </div>

        {/* Option toggles */}
        <div className="loreport-options">
          <label className="loreport-option">
            <input
              type="checkbox"
              checked={groupByCategory}
              onChange={(e) => setGroupByCategory(e.target.checked)}
              disabled={format === 'server'}
            />
            <span>{isRu ? 'Группировать по категориям MLOS' : 'Group by MLOS category'}</span>
          </label>
          <label className="loreport-option">
            <input
              type="checkbox"
              checked={includeLinks}
              onChange={(e) => setIncludeLinks(e.target.checked)}
              disabled={format === 'server'}
            />
            <span>{isRu ? 'Включать ссылки Steam Workshop' : 'Include Steam links'}</span>
          </label>
          <label className="loreport-option">
            <input
              type="checkbox"
              checked={includeStats}
              onChange={(e) => setIncludeStats(e.target.checked)}
            />
            <span>{isRu ? 'Включать общую статистику' : 'Include summary stats'}</span>
          </label>
        </div>

        {/* Preview Area */}
        <div className="lomodal__body loreport-body">
          <textarea
            className="loreport-textarea mono"
            readOnly
            value={reportText}
            rows={18}
            spellCheck={false}
          />
        </div>

        {/* Footer */}
        <div className="lomodal__foot">
          <button className="btn" onClick={onClose}>
            {isRu ? 'Закрыть' : 'Close'}
          </button>
          <div className="toolbar__spacer" />
          <button className="btn" onClick={handleDownload} title={isRu ? 'Сохранить файл на диск' : 'Save file to disk'}>
            <Icon name="download" size={12} />
            {isRu ? 'Сохранить файл' : 'Save File'}
          </button>
          <button className="btn is-primary" onClick={handleCopy}>
            <Icon name="copy" size={12} />
            {isRu ? 'Скопировать в буфер' : 'Copy to Clipboard'}
          </button>
        </div>
      </div>
    </div>
  )
}
