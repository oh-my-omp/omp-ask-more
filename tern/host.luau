-- The `demo` block: the file demos of the ask form open beside it, each in Tern's media viewer.
--
-- The window half (`window.luau`) opens it with one launch argument, a JSON array of
-- `{label, path, caption?}` in the order the form shows them; `label` is the heading the form
-- gives the demo ("Demo", or "<option>: demo"). Each demo is a card headed by that heading, holding
-- its caption as text (a card's head is one line, cut at the block's width) and a TSP `media` node
-- by path: Tern loads the file and shows a picture, an SVG, a 3D model, a PDF, a video or audio
-- with its controls, or a card for any other file. A card's role
-- `omp-ask-more.demo.<n>` (0-based) names the demo for styles and for tests driving the window.
-- Nothing is saved: the block belongs to one open form, and the window half closes a leftover one.

type Demo = { label: string, path: string, caption: string? }
type State = { demos: { Demo } }

local function parse(arg: string?): { Demo }
	if arg == nil or arg == "" then
		return {}
	end
	local ok, value = pcall(tern.json.decode, arg)
	if not ok or type(value) ~= "table" then
		return {}
	end
	local demos: { Demo } = {}
	for _, item in value do
		if type(item) == "table" and type(item.label) == "string" and type(item.path) == "string" then
			table.insert(demos, {
				label = item.label,
				path = item.path,
				caption = if type(item.caption) == "string" then item.caption else nil,
			})
		end
	end
	return demos
end

local function card(demo: Demo, index: number)
	local children = {}
	if demo.caption ~= nil then
		table.insert(children, tern.ui.text({ tern.ui.span(demo.caption, "muted") }))
	end
	table.insert(children, tern.ui.node("media", { path = demo.path }))
	return tern.ui.card({ tern.ui.span(demo.label, "strong") }, children, {
		role = "omp-ask-more.demo." .. (index - 1),
	})
end

tern.block.define("demo", {
	init = function(_cx, args, _saved)
		return { demos = parse(args[1]) }
	end,
	view = function(state: State, _cx)
		local cards = {}
		for index, demo in state.demos do
			table.insert(cards, card(demo, index))
		end
		return { main = tern.ui.col(cards) }
	end,
	title = function(state: State)
		local labels = {}
		for _, demo in state.demos do
			table.insert(labels, demo.label)
		end
		return table.concat(labels, " · ")
	end,
})
