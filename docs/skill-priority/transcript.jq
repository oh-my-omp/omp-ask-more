# Renders one omp session JSONL (slurped) as a markdown transcript of what the
# model saw from the person, what it thought and said, and every ask call.
def fence(lang; s): "```" + lang + "\n" + s + "\n```";
def text_of(c): [c[]? | select(.type == "text") | .text] | join("\n");

.[] |
if .type == "custom_message" and .customType == "skill-prompt" then
	"## Person: `" + .details.prompt + "`\n\nomp injected the skill as a user-attributed message: its first line, then the " + (.details.lineCount | tostring) + " lines of `" + .details.name + "/SKILL.md`.\n\n" + fence("text"; ((.content // "") | tostring | split("\n") | first))
elif .type == "custom_message" and .customType == "session-stop-continuation" then
	"## Guard continuation (variant V3, `session_stop`)\n\n" + fence("text"; (.content // "") | tostring)
elif .type == "message" and .message.role == "user" then
	"## Person\n\n" + text_of(.message.content)
elif .type == "message" and .message.role == "assistant" then
	[.message.content[]? |
		if .type == "thinking" and ((.thinking // "") | length) > 0 then
			"### Model reasoning\n\n" + fence("text"; .thinking)
		elif .type == "text" and (.text | length) > 0 then
			"### Model reply\n\n" + .text
		elif .type == "toolCall" and .name == "ask" then
			"### ask call\n\n" + fence("json"; (.arguments | del(.i) | tojson))
		elif .type == "toolCall" then
			"- tool `" + .name + "` " + ((.arguments.path // "") | tostring)
		else empty end
	] | join("\n\n")
elif .type == "message" and .message.role == "toolResult" and .message.toolName == "ask" then
	"### ask result\n\n" + fence("text"; text_of(.message.content))
else empty end
| select(length > 0) + "\n"
