---
id: m-10
title: "M11 Feed model: one item derived per post, three formats"
---

## Description

RSS, Atom and JSON Feed each re-derive their items from the document and already disagree about identity, terms and summary. Derive one feed item per post and render the three formats from it; then, per decision-12, make every format key a post by its ActivityStreams object id. The second half is a breaking change to public output.
