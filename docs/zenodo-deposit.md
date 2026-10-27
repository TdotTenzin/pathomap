# Publishing PathoMap on Zenodo

This guide produces a citable, permanent DOI for the curated dataset. The
repository already contains the metadata files and a build script; you only need
to fill in a few placeholders and upload the result.

## 1. Fill in the placeholders (required)

The metadata ships with **placeholders** that must be replaced before you
publish. Nothing here is guessed on your behalf.

| File | Placeholder | Replace with |
| --- | --- | --- |
| `.zenodo.json` | `YOUR-LASTNAME, YourFirstname`, `0000-0000-0000-0000`, `YOUR AFFILIATION`, `YOUR-USERNAME` | your name, ORCID iD, affiliation, GitHub org/user |
| `CITATION.cff` | same set, plus `10.5281/zenodo.XXXXXXX` | the DOI Zenodo assigns (step 4) |

## 2. Choose a license (required)

`.zenodo.json` and `CITATION.cff` currently declare **CC-BY-4.0**, a common
choice for open datasets. Change both if your institution or co-authors require
a different license (e.g. MIT, CC0). If you add a `LICENSE` file at the repo
root it will be bundled into the archive automatically.

## 3. Build the deposit archive

```bash
python scripts/prepare_zenodo_deposit.py
```

This writes:

- `dist/pathomap-v0.4.0.zip` — dataset + code + metadata
- `dist/SHA256SUMS` — checksum for integrity verification

The archive contains the SQLite database, every seed CSV (including
`literature.csv` and `effector_sequences.csv`), the citation files, and the
project metadata. Re-run the script whenever the dataset changes so the version
and contents stay in sync.

## 4. Create the Zenodo record

1. Sign in to <https://zenodo.org> (GitHub login works).
2. **New upload** → drag in `dist/pathomap-v0.4.0.zip`.
3. Zenodo reads `.zenodo.json` from the archive and pre-fills the metadata.
   Confirm the creator, license and keywords.
4. Publish. Zenodo mints a DOI of the form `10.5281/zenodo.NNNNNNN`.

### Alternative: GitHub integration

If the repository is on GitHub, connect it under **Zenodo → Settings → GitHub**
and enable the repo. Each tagged release is archived and gets a DOI
automatically. A [version DOI](https://help.zenodo.org/#versioning) lets you
cite v0.4.0 specifically.

## 5. Record the DOI

Paste the assigned DOI into:

- `CITATION.cff` → `doi`
- `.zenodo.json` → add `"doi": "10.5281/zenodo.NNNNNNN"`
- `README.md` and the "How to Cite" section of `index.html`

Then rebuild the archive (step 3) so the published metadata carries the DOI.

## Notes

- The deposit is **snapshotted**; fixing mistakes requires a new version.
- Keep `dist/` out of version control (it is a build artifact).
- Verify the checksum after download: `sha256sum -c SHA256SUMS`.
