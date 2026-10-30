# One line per run (slurped session JSONL): the channel of every user-facing question round, in order.
#   ask(N)            an ask call with N questions that opened and was answered
#   ask(N) rejected   an ask call the plugin rejected before opening (the model then retried)
#   chat(N)           a reply that ended the turn with N questions written in the reply
def results: [.[] | select(.type == "message" and .message.role == "toolResult" and .message.toolName == "ask")
	| {id: .message.toolCallId, text: ([.message.content[]? | select(.type == "text") | .text] | join("\n"))}];
results as $r
| [.[] | select(.type == "message" and .message.role == "assistant") | .message.content[]?
	| if .type == "toolCall" and .name == "ask" then
		(.id as $id | ($r | map(select(.id == $id)) | first | .text // "") as $t
		| "ask(\(.arguments.questions | length))" + (if ($t | startswith("User answers")) then "" else " rejected" end))
	elif .type == "text" and (.text | test("❓")) then
		"chat(\([.text | scan("❓"; "g")] | length))"
	else empty end]
| join(" → ")
