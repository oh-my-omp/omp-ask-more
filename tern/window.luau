-- Plays the ask form's file demos in Tern.
--
-- omp's HTML form shows a demo file it cannot draw as a picture as one line of text, its
-- `file://` URL and ` — <caption>`, under a heading ("Demo", or "<option>: demo"); the form has no
-- media element, so Tern's own omp view leaves that line as text. While an omp pane waits for an
-- answer (`agent_state` `waiting_input`), this half reads the pane's surface every POLL_MS, takes
-- those lines from the question the form has open (`omp.ask.open`), and opens the host half's `demo`
-- block beside the pane with them, without taking the keyboard from the form. When the open
-- question's demos change the block is opened again with the new ones, or closed when there are
-- none; when the pane stops waiting, or ends, the block closes. A block the user closed stays
-- closed until the demos change.

local KIND = "omp-ask-ng.demo"
local POLL_MS = 500
local CAPTION = " — "

type Demo = { label: string, path: string, caption: string? }
type Watch = { block: number?, key: string, timer: TimerHandle? }

local watched: { [number]: Watch } = {}

local function textOf(node: TspNode): string
	local p = node.p
	if p == nil then
		return ""
	end
	if type(p.text) == "string" then
		return p.text
	end
	local parts = {}
	if type(p.spans) == "table" then
		for _, span in p.spans do
			if type(span) == "table" and type(span.t) == "string" then
				table.insert(parts, span.t)
			end
		end
	end
	return table.concat(parts)
end

local function role(node: TspNode): string?
	local p = node.p
	return if p ~= nil and type(p.role) == "string" then p.role else nil
end

-- The last node with `wanted` role in document order, over the surface's regions.
local function lastWithRole(tree: SurfaceTree, wanted: string): TspNode?
	local found: TspNode? = nil
	local function walk(node: TspNode?)
		if node == nil then
			return
		end
		if role(node) == wanted then
			found = node
		end
		for _, child in node.c or {} do
			walk(child)
		end
	end
	walk(tree.main)
	walk(tree.dock)
	walk(tree.layer)
	return found
end

-- `file:///a/b%20c.mp4` → `/a/b c.mp4`; on Windows `file:///D:/a.mp4` → `D:/a.mp4` (the slash
-- before a drive letter belongs to the URL, as Node's `fileURLToPath` drops it) and a share's
-- `file://nas/share/a.mp4` → `//nas/share/a.mp4`; nil for anything that is not a file URL.
local function filePath(url: string): string?
	local host, rest = string.match(url, "^file://([^/]*)(/.*)$")
	if host == nil or rest == nil then
		return nil
	end
	local path = string.gsub(rest, "%%(%x%x)", function(hex)
		return string.char(tonumber(hex, 16) :: number)
	end)
	if host ~= "" then
		return "//" .. host .. path
	end
	if string.match(path, "^/%a:/") ~= nil then
		return string.sub(path, 2)
	end
	return path
end

-- The file demos of the open question, each with the heading of the text node above its line.
local function demosIn(open: TspNode): { Demo }
	local demos: { Demo } = {}
	local previous: string? = nil
	local function walk(node: TspNode)
		if node.k == "text" and role(node) == "omp.ask.text" then
			local line = textOf(node)
			if string.sub(line, 1, 7) == "file://" then
				local at = string.find(line, CAPTION, 1, true)
				local url = if at ~= nil then string.sub(line, 1, at - 1) else line
				local path = filePath(url)
				if path ~= nil and previous ~= nil then
					table.insert(demos, {
						label = previous,
						path = path,
						caption = if at ~= nil then string.sub(line, at + #CAPTION) else nil,
					})
				end
			end
			previous = line
		end
		for _, child in node.c or {} do
			walk(child)
		end
	end
	walk(open)
	return demos
end

local function closeBlock(cx: WindowCx, watch: Watch)
	if watch.block ~= nil and cx.session:pane(watch.block) ~= nil then
		cx.layout:close(watch.block)
	end
	watch.block = nil
end

-- The question the form has open. The form is a top-level block of the surface's main region
-- (`omp.ask.card`, after the transcript); a read of the whole surface spends its node budget on
-- the transcript first and, in a long session, can leave the form out. So: the main region's
-- top-level blocks alone (one node per block), then the last ask card's own subtree.
local function openQuestion(cx: WindowCx, pane: number): TspNode?
	local top = cx.session:surface(pane, { depth = 1, nodes = 5000 })
	if type(top) ~= "table" or top.main == nil then
		return nil
	end
	local blocks = top.main.c or {}
	for index = #blocks, 1, -1 do
		local block = blocks[index]
		if role(block) == "omp.ask.card" then
			local card = cx.session:surface(pane, { root = block.id, nodes = 5000 })
			return if type(card) == "table" then lastWithRole(card, "omp.ask.open") else nil
		end
	end
	return nil
end

local function sync(cx: WindowCx, pane: number, watch: Watch)
	local open = openQuestion(cx, pane)
	local demos: { Demo } = if open ~= nil then demosIn(open) else {}
	local key = if #demos > 0 then tern.json.encode(demos) else ""
	if key == watch.key then
		return
	end
	closeBlock(cx, watch)
	watch.key = key
	if key ~= "" then
		watch.block = cx:new_block(KIND, { key }, "beside", { focus = false, target = pane, dir = "right" })
	end
end

local function stop(cx: WindowCx, pane: number)
	local watch = watched[pane]
	if watch == nil then
		return
	end
	watched[pane] = nil
	if watch.timer ~= nil then
		watch.timer:cancel()
	end
	closeBlock(cx, watch)
end

-- Agents are listed, and may report state, across every session; a window watches its own panes,
-- the ones its blocks can open beside.
local function start(cx: WindowCx, pane: number)
	if watched[pane] ~= nil or cx.session:pane(pane) == nil then
		return
	end
	local watch: Watch = { block = nil, key = "", timer = nil }
	watched[pane] = watch
	local function tick(tcx: WindowCx?)
		if watched[pane] ~= watch or tcx == nil then
			return
		end
		sync(tcx, pane, watch)
		watch.timer = tern.timer(POLL_MS, tick)
	end
	tick(cx)
end

tern.on("agent_state", function(ev: AgentStateEvent, cx: WindowCx)
	if ev.new == "waiting_input" then
		start(cx, ev.pane)
	else
		stop(cx, ev.pane)
	end
end)

tern.on("agent_finished", function(ev: AgentFinishedEvent, cx: WindowCx)
	stop(cx, ev.pane)
end)

tern.on("pane_closed", function(ev: { pane: number }, cx: WindowCx)
	stop(cx, ev.pane)
end)

-- A reload or a restart loses the watches: close demo blocks left from before, then watch every
-- omp pane already waiting for an answer.
tern.on("window_start", function(cx: WindowCx)
	for _, info in cx.session:panes() do
		if info.kind == "plugin" and info.block == KIND then
			cx.layout:close(info.pane)
		end
	end
	for _, agent in cx.agents:list() do
		if agent.state == "waiting_input" then
			start(cx, agent.pane)
		end
	end
end)
