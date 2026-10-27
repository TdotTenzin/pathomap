# Structure

This is the v2 scaffold. Keep it minimal and add only what you need, one slice at a time.

## File Tree
`
pathomap-v2/
├── assets/
├── css/
│   ├── base.css
│   ├── layout.css
│   ├── components.css
│   └── utilities.css
├── data/
├── docs/
├── js/
│   ├── main.js
│   ├── utils/
│   ├── data/
│   ├── ui/
│   └── views/
├── index.html
└── README.md
`

## Rules
- One feature per commit/branch
- No copying whole files from archive
- Structure first, logic later
- Data goes through js/data/loader.js (create when needed)
- Views are created only when implementing that slice
