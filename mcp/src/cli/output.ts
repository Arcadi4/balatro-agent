import {
  ProtocolError,
  ProtocolErrorCode,
  ResourceNotFoundError,
} from "@modelcontextprotocol/server"
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/server"
import { CommanderError } from "commander"
import { ZodError } from "zod"

import { BridgeError } from "../bridge/socket-client.js"
import { asRecord, toolErrorSchema } from "../response.js"

interface CliError {
  error_code: string
  message: string
  details?: Record<string, unknown>
}

const INTERNAL_ERROR = "INTERNAL_ERROR"
const USAGE_ERROR = "USAGE_ERROR"
const INVALID_RESOURCE_URI = "INVALID_RESOURCE_URI"
const RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND"
const TOOL_ERROR = "TOOL_ERROR"

interface CliStream {
  write(chunk: string): unknown
}

function writeLine(stream: CliStream, text: string): void {
  stream.write(text.endsWith("\n") ? text : `${text}\n`)
}

// Every --json response is exactly one line of machine-readable output.
function writeJson(value: unknown): void {
  writeLine(process.stdout, JSON.stringify(value))
}

// Actions already answer {ok, data?, next?}; connect/disconnect carry ok plus
// flat fields, so both are preserved exactly. Results that carry no envelope of
// their own (wiki results, the postgame reference) are wrapped in data.
// A missing structured payload is an ill-formed result, never a success.
function successEnvelope(structured: Record<string, unknown> | undefined): Record<string, unknown> {
  if (structured === undefined) {
    throw new Error("Tool call returned no structured content")
  }
  if (structured.ok === true) return structured
  return { ok: true, data: structured }
}

function toolResultError(result: CallToolResult): CliError | undefined {
  if (result.isError !== true) return undefined
  const parsed = toolErrorSchema.safeParse(result.structuredContent)
  if (parsed.success) return parsed.data
  const message = result.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .trim()
  return { error_code: TOOL_ERROR, message: message === "" ? "Tool call failed" : message }
}

function bridgeExitCode(code: string): number {
  switch (code) {
    case "GAME_NOT_RUNNING":
      return 3
    case "INSTANCE_SELECTION_REQUIRED":
      return 4
    case USAGE_ERROR:
    case INVALID_RESOURCE_URI:
      return 2
    case TOOL_ERROR:
      return 1
    default:
      return 5
  }
}

// A diagnostic copied into the envelope's own error_code would duplicate it.
function cleanDetails(
  code: string,
  details: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (details === undefined) return undefined
  const cleaned = Object.fromEntries(
    Object.entries(details).filter(([key, value]) => key !== "error_code" || value !== code),
  )
  return Object.keys(cleaned).length === 0 ? undefined : cleaned
}

function printError(error: CliError, json: boolean): void {
  const details = cleanDetails(error.error_code, error.details)
  if (json) {
    writeJson({
      error_code: error.error_code,
      message: error.message,
      ...(details === undefined ? {} : { details }),
    })
    return
  }
  writeLine(process.stderr, `Error [${error.error_code}]: ${error.message}`)
  if (details !== undefined) writeLine(process.stderr, JSON.stringify(details))
}

function zodMessage(error: ZodError): string {
  if (error.issues.length === 0) return error.message
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String).join(".")
      return path === "" ? issue.message : `${path}: ${issue.message}`
    })
    .join("; ")
}

function errorFromUnknown(error: unknown): { error: CliError; exitCode: number } | undefined {
  // Commander throws code 0 after printing help or the version; that termination
  // already succeeded and must not add output.
  if (error instanceof CommanderError) {
    if (error.exitCode === 0) return undefined
    return { error: { error_code: USAGE_ERROR, message: error.message }, exitCode: 2 }
  }
  if (error instanceof ZodError) {
    return { error: { error_code: USAGE_ERROR, message: zodMessage(error) }, exitCode: 2 }
  }
  if (error instanceof ResourceNotFoundError) {
    return {
      error: {
        error_code: RESOURCE_NOT_FOUND,
        message: error.message,
        details: { uri: error.uri },
      },
      exitCode: 5,
    }
  }
  if (error instanceof ProtocolError) {
    const details = asRecord(error.data)
    const rawCode = details?.error_code
    const specific = typeof rawCode === "string" ? rawCode : undefined
    if (specific !== undefined) {
      return {
        error: {
          error_code: specific,
          message: error.message,
          ...(details === undefined ? {} : { details }),
        },
        exitCode: bridgeExitCode(specific),
      }
    }
    if (error.code === ProtocolErrorCode.InvalidParams) {
      return {
        error: {
          error_code: INVALID_RESOURCE_URI,
          message: error.message,
          ...(details === undefined ? {} : { details }),
        },
        exitCode: 2,
      }
    }
    return {
      error: {
        error_code: INTERNAL_ERROR,
        message: error.message,
        ...(details === undefined ? {} : { details }),
      },
      exitCode: 1,
    }
  }
  if (error instanceof BridgeError) {
    return {
      error: { error_code: error.code, message: error.message, details: error.details },
      exitCode: bridgeExitCode(error.code),
    }
  }
  const envelope = asRecord(error)
  const envelopeCode = envelope?.error_code
  if (envelope !== undefined && typeof envelopeCode === "string") {
    const details = asRecord(envelope.details)
    return {
      error: {
        error_code: envelopeCode,
        message: typeof envelope.message === "string" ? envelope.message : envelopeCode,
        ...(details === undefined ? {} : { details }),
      },
      exitCode: envelopeCode === INTERNAL_ERROR ? 1 : bridgeExitCode(envelopeCode),
    }
  }
  if (error instanceof Error) {
    return { error: { error_code: INTERNAL_ERROR, message: error.message }, exitCode: 1 }
  }
  return { error: { error_code: INTERNAL_ERROR, message: String(error) }, exitCode: 1 }
}

/**
 * Prints one tool result and returns the CLI exit code for it.
 *
 * JSON keeps an existing ok envelope (actions, connect, disconnect) unchanged
 * and wraps un-enveloped structured content as {ok:true, data}. Errors always
 * become {error_code, message, details?} on stdout; human text stays on stderr.
 * A result with no payload for the requested mode is INTERNAL_ERROR with exit 1.
 */
export function printToolResult(result: CallToolResult, json: boolean): number {
  const error = toolResultError(result)
  if (error !== undefined) {
    printError(error, json)
    return bridgeExitCode(error.error_code)
  }
  const structured = asRecord(result.structuredContent)
  if (json) {
    if (structured === undefined) {
      printError(
        { error_code: INTERNAL_ERROR, message: "Tool call returned no structured content" },
        true,
      )
      return 1
    }
    writeJson(successEnvelope(structured))
    return 0
  }
  const text = result.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
  if (text !== "") {
    writeLine(process.stdout, text)
  } else if (structured !== undefined) {
    writeLine(process.stdout, JSON.stringify(structured))
  } else {
    printError(
      {
        error_code: INTERNAL_ERROR,
        message: "Tool call returned no text or structured content",
      },
      false,
    )
    return 1
  }
  return 0
}

/**
 * Prints one resource payload and returns the CLI exit code for it.
 *
 * JSON prints the MCP text content directly as {uri, mimeType, text}; human mode
 * prints its Markdown text unchanged.
 */
export function printResourceResult(result: ReadResourceResult, json: boolean): number {
  const first = result.contents[0]
  if (first === undefined || !("text" in first) || typeof first.text !== "string") {
    printError(
      {
        error_code: INTERNAL_ERROR,
        message:
          first === undefined
            ? "Resource read returned no contents"
            : "Resource read returned a non-text payload",
      },
      json,
    )
    return 1
  }
  if (json) {
    writeJson({ uri: first.uri, mimeType: first.mimeType, text: first.text })
    return 0
  }
  writeLine(process.stdout, first.text)
  return 0
}

/** Prints an arbitrary failure (Commander, Zod, SDK, bridge, or unexpected). */
export function printCliError(error: unknown, json: boolean): number {
  const failure = errorFromUnknown(error)
  if (failure === undefined) return 0
  printError(failure.error, json)
  return failure.exitCode
}
