# Considerations — Card Collector v2

Open questions that a human can answer in prose. Visual ones live in `STYLE.md`.

- Config's download-plan row names one destination three ways in one screen: the button **"Make local"** (`index.html:7372`), the button beside it **"Everything on disk"** (`:7377`), and the schema table's column header **"On-disk"** (`:7170`). Which single word wins — *local* or *on disk*?
- The io page's file input is labelled **"Export file"** (`index.html:6876`) inside a band titled **Import**, reached from a nav item labelled **Import**. It means "the file your other app exported". Keep it, or rename it to something like "Import a CSV"?
