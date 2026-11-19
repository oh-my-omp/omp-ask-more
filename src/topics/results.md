The result starts with `User answers:` and has one line per question, in the order you asked:

- `id: label`: the user picked that option.
- `id: "text"`: the user typed their own answer.
- `id: (no answer)`: the user submitted the form without answering this question.
- `id: (timed out: …)`: the form closed at its timeout before the user answered this question; decide it yourself, say what you chose, and continue. Lines with an answer still stand.

`Option notes:` lines follow when the user wrote a note on a chosen option; images pasted into a note come with the result.

If the user sends a message while the form is open, the form closes and the call ends as interrupted, listing the answers they gave so far as JSON; their message reaches you next. If they cancel, the turn stops.
