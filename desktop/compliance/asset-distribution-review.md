# Asset distribution review

Reviewed: 2026-11-27  
Scope: Brickwright desktop application and its matching source archive.

## Packaged local media

`assets-rights.json` identifies 1,776 local application-media files by path and SHA-256, grouped into 1,765 distinct byte hashes and source directories. The repository history contains an explicit 2021 license change (`1c7850d47`, “Make everything GPLv3”); the current root `LICENSE` and package metadata declare GPL. The earlier BSD-3-Clause notice remains included separately because the prior revision contained it. This review does not claim that GPL overrides a third-party license where an asset has a separate upstream notice. File-specific notices found in the source tree are separately included: the custom Seti UI icon attribution, TurboWarp icon attributions, and Londrina SIL Open Font License.

This is a source/license-scope review, not a claim that 1,776 independent third-party rights investigations were performed. Individual generated `UNVERIFIED` fields are bookkeeping fields; they do not assert infringement or negate repository licensing. They also do not independently establish permission for a separately licensed asset. The review preserves the source groups and file hashes so separate notices or exceptions remain actionable. An asset with a conflicting or separately restrictive license must be reviewed on that evidence; the aggregate count alone is not a finding of infringement.

## Scratch library catalog references

The current inventory contains 1,301 backdrop, costume, and sound catalog references. Every such record has an empty `filePaths` list: these JSON entries retain names and content identifiers but do not include the referenced media payload. They are therefore reviewed as catalog metadata rather than as bundled library media. The packaged editor resolves media through the existing asset service when a user opens or uses a library item.

## Brand and affiliation review

The desktop product name and configured application icons identify Brickwright. The optional time-travel mode no longer swaps the Brickwright header mark for Scratch Cat or historical Scratch marks. The About screen identifies the project as independent, disclaims LEGO Group/Scratch Foundation/TurboWarp endorsement, and includes the Scratch source attribution. See `brand-review.md` and the `TRADEMARK` notice.
