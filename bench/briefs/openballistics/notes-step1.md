# Step 1: classifying the deliberate ambiguity

Deliberate ambiguity of step 1: "Deployment of the site to GitHub Pages" does not say when the site deploys (every
push to main, or only on a release tag). Both readings pass S1-pages-trigger (validate-step1.sh case deploy-on-tags).
Detection from the step 1 transcript: asked = an AskUserQuestion tool call (whether headless `claude -p` offers it is
unverified), or an assistant message with a `?` next to Pages, deploy, main, tag or release (`waited` in
`steps/1/` covers only the first turn's final message); assumed and stated = the final message or a file names the choice as an assumption or decision; assumed silently
= neither, the choice is only the `on:` of the deploy workflow (named in the S1-pages-trigger detail).
