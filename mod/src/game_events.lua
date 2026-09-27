-- Game-event observation for deferred actions. A work mark snapshots the
-- event queues as they were before an action ran, so "the action's work
-- finished" can be scoped to that action. A global drained() scan never
-- becomes true during a run on mod stacks that keep events queued.
local GameEvents = {}

function GameEvents.mark_work()
  local mark = { events = {} }
  local manager = G and G.E_MANAGER
  if not manager or not manager.queues then return mark end
  for _, queue in pairs(manager.queues) do
    for i = 1, #queue do
      mark.events[queue[i]] = true
    end
  end
  return mark
end

-- Settled when no queued event is both newer than the mark and transient.
-- Persistent (no_delete) events survive queue resets by design and do not
-- block action completion.
function GameEvents.work_settled(mark)
  local manager = G and G.E_MANAGER
  if not manager or not manager.queues then return true end
  for _, queue in pairs(manager.queues) do
    for i = 1, #queue do
      local event = queue[i]
      if not event.no_delete and not mark.events[event] then return false end
    end
  end
  return true
end

return GameEvents
