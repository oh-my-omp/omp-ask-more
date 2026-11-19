The result text depends on which surface answered.

On the full-screen page, each result line is `id: label` (a choice), `id: "text"` (the user's own answer), `id: (cancelled)` (unanswered), or `id: (timed out: …)`: no answer in time, so decide it yourself, state what you chose, and continue.

When the call delegates to the host's `ask`, the result is the host's own wording: `User answers:` followed by the submitted form data as JSON — `{"id": "label"}` per question, or the typed text for the form's free-text answer — or `No answer before the timeout; submitted the form's current values:` plus that JSON, where the submitted values are your preselected options, not the user's answers; decide the undecided questions yourself and say so.
