#!/usr/bin/env node
import * as readline from 'node:readline';
import {
  decompileClass,
  lookupEvent,
  validateItemScript,
  validateSandboxOptions,
  syncPortMod,
  auditHygiene
} from './pz_tools.js';

const TOOLS = [
  {
    name: 'pz_decompile_class',
    description: 'Decompile Java classes from Project Zomboid engine projectzomboid.jar with method filtering and disk caching.',
    inputSchema: {
      type: 'object',
      properties: {
        className: {
          type: 'string',
          description: 'Full Java class name (e.g. zombie.characters.IsoPlayer, zombie.inventory.types.HandWeapon)'
        },
        methodFilter: {
          type: 'string',
          description: 'Optional regex or substring to filter methods/fields (e.g. Hit, doAttack, isAiming)'
        }
      },
      required: ['className']
    }
  },
  {
    name: 'pz_lookup_event',
    description: 'Search and inspect the canonical 232 LuaEventManager engine events in Project Zomboid B41/B42.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keyword or event prefix (e.g. Hit, Weapon, Tick, Render, Craft)'
        }
      }
    }
  },
  {
    name: 'pz_validate_item_script',
    description: 'Validate an item, weapon or craft script against Build 42 namespace and syntax rules.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Absolute path to the script file (or relative to workspace)'
        },
        content: {
          type: 'string',
          description: 'Optional direct script text to validate'
        }
      }
    }
  },
  {
    name: 'pz_validate_sandbox_options',
    description: 'Validate a sandbox-options.txt file for trailing comma in VERSION = 1, UTF-8 without BOM, and option types.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Path to sandbox-options.txt'
        }
      },
      required: ['filePath']
    }
  },
  {
    name: 'pz_sync_port_mod',
    description: 'Safely sync a *_Port mod folder to C:\\Users\\tamer\\Zomboid\\mods with automatic BOM removal and Cyrillic audit.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceModPath: {
          type: 'string',
          description: 'Absolute path to the working port mod (e.g. E:\\REMOD_Port)'
        },
        targetModName: {
          type: 'string',
          description: 'Optional destination folder name under Zomboid/mods'
        }
      },
      required: ['sourceModPath']
    }
  },
  {
    name: 'pz_audit_hygiene',
    description: 'Scan mod folder for UTF-8 BOM, Cyrillic outside Translate/RU, versionMax issues, and B42 structure compliance.',
    inputSchema: {
      type: 'object',
      properties: {
        modPath: {
          type: 'string',
          description: 'Absolute path to mod directory'
        }
      },
      required: ['modPath']
    }
  }
];

function sendResponse(id, result, error = null) {
  const response = {
    jsonrpc: '2.0',
    id
  };
  if (error) {
    response.error = error;
  } else {
    response.result = result;
  }
  process.stdout.write(JSON.stringify(response) + '\n');
}

function handleMessage(message) {
  if (!message || typeof message !== 'object') return;

  const { id, method, params } = message;

  // Handle Notifications (no response needed)
  if (id === undefined || id === null) {
    return;
  }

  try {
    switch (method) {
      case 'initialize': {
        sendResponse(id, {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'pz-modding-mcp',
            version: '1.0.0'
          }
        });
        break;
      }

      case 'ping': {
        sendResponse(id, {});
        break;
      }

      case 'tools/list': {
        sendResponse(id, { tools: TOOLS });
        break;
      }

      case 'tools/call': {
        const { name, arguments: args } = params || {};
        let res = null;

        switch (name) {
          case 'pz_decompile_class':
            res = decompileClass(args || {});
            break;
          case 'pz_lookup_event':
            res = lookupEvent(args || {});
            break;
          case 'pz_validate_item_script':
            res = validateItemScript(args || {});
            break;
          case 'pz_validate_sandbox_options':
            res = validateSandboxOptions(args || {});
            break;
          case 'pz_sync_port_mod':
            res = syncPortMod(args || {});
            break;
          case 'pz_audit_hygiene':
            res = auditHygiene(args || {});
            break;
          default:
            throw new Error(`Unknown tool: ${name}`);
        }

        sendResponse(id, {
          content: [
            {
              type: 'text',
              text: typeof res === 'string' ? res : JSON.stringify(res, null, 2)
            }
          ]
        });
        break;
      }

      default: {
        sendResponse(id, null, {
          code: -32601,
          message: `Method not found: ${method}`
        });
        break;
      }
    }
  } catch (err) {
    sendResponse(id, null, {
      code: -32603,
      message: err.message || 'Internal error'
    });
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const msg = JSON.parse(trimmed);
    handleMessage(msg);
  } catch (err) {
    // Ignore invalid JSON on stdin
  }
});
