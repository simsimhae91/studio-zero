---
name: build
description: Run the Studio Zero build workflow with native Codex workers when the owner explicitly requests an unattended build.
---
Read the start questions in the sz:work skill. Ask the owner in the current conversation and keep their answers verbatim. Use asked="away" only when they explicitly ask you to proceed without questions or the run is already unattended. Only the owner may select design="go".

Run the executable bin/sz-codex-build relative to this plugin's root (three directories up from this skill's directory), with the target project as the working directory. Pass one JSON object on stdin with request, asked and answers. Use a quoted heredoc or a file so the user's words stay data. The runner also accepts maxMilestones, side, and an optional Codex model ID. It starts fresh Codex workers and can take as long as the build. Monitor its stage messages. On a design stop show the prototype, record the owner's actual verdict with sz-eyes contract judged design feel --verdict yes|no --said "<their words>", and restart with those words. Report stopped, notBuilt, and each evidence page from the result.
