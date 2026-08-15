local SocketCodec = {}
local MAX_FRAME_SIZE = 65536

function SocketCodec.new(on_request, log)
  local incoming = ''
  local outgoing = ''
  local codec = {}

  function codec.feed(chunk)
    incoming = incoming .. chunk
    while true do
      local newline = incoming:find('\n', 1, true)
      if not newline then break end
      if newline - 1 > MAX_FRAME_SIZE then return false, 'frame exceeds 64 KiB' end

      local line = incoming:sub(1, newline - 1):gsub('\r$', '')
      incoming = incoming:sub(newline + 1)
      if line ~= '' then
        local decoded, request = pcall(JSON.decode, line)
        if decoded then
          on_request(request)
        else
          log('Invalid JSON request: ' .. tostring(request))
        end
      end
    end

    if #incoming > MAX_FRAME_SIZE then return false, 'frame exceeds 64 KiB' end
    return true
  end

  function codec.queue(response)
    local encoded, payload = pcall(JSON.encode, response)
    if not encoded then return false, 'response encode failed: ' .. tostring(payload) end
    outgoing = outgoing .. payload .. '\n'
    return true
  end

  function codec.pending()
    return outgoing
  end

  function codec.consume(bytes)
    outgoing = outgoing:sub(bytes + 1)
  end

  function codec.reset()
    incoming = ''
    outgoing = ''
  end

  return codec
end

return SocketCodec
