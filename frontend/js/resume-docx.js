const COLOR_PRIMARY = "3F5E4E";
const COLOR_TEXT = "2B2B28";
const COLOR_MUTED = "70756B";
const COLOR_RULE = "5D7A63";

const KNOWN_SECTIONS = [
  "SUMMARY",
  "SKILLS",
  "EXPERIENCE",
  "EDUCATION",
  "PROJECTS",
  "CERTIFICATIONS",
  "INTERESTS",
];

const SIDEBAR_SECTIONS = new Set(["SKILLS", "EDUCATION", "CERTIFICATIONS", "INTERESTS"]);

// --- Parsing -----------------------------------------------------------

function parseResumeText(text) {
  const lines = text.trim().split("\n").map((l) => l.replace(/\s+$/, ""));

  let headerLine = "";
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim()) {
      headerLine = lines[i].trim();
      bodyStart = i + 1;
      break;
    }
  }

  const parts = headerLine.split("|").map((p) => p.trim()).filter(Boolean);
  const name = parts[0] || "Your Name";
  let title = null;
  let contact = [];

  if (parts.length === 2) {
    title = parts[1];
  } else if (parts.length > 2) {
    title = parts[1];
    contact = parts.slice(2);
  }

  const sections = {};
  let currentSection = null;
  let buffer = [];

  function flush() {
    if (currentSection === null) {
      buffer = [];
      return;
    }
    if (currentSection === "SUMMARY") {
      sections[currentSection] = buffer.join("\n").trim();
    } else if (["SKILLS", "CERTIFICATIONS", "INTERESTS"].includes(currentSection)) {
      sections[currentSection] = buffer
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => l.replace(/^[•\-*]\s*/, ""));
    } else if (["EXPERIENCE", "PROJECTS"].includes(currentSection)) {
      sections[currentSection] = parseEntries(buffer);
    } else if (currentSection === "EDUCATION") {
      sections[currentSection] = parseEducation(buffer);
    }
    buffer = [];
  }

  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i];
    const stripped = line.trim();
    const upper = stripped.toUpperCase();
    if (KNOWN_SECTIONS.includes(upper) && stripped === upper) {
      flush();
      currentSection = upper;
      continue;
    }
    buffer.push(line);
  }
  flush();

  return { name, title, contact, sections };
}

function parseEntries(buffer) {
  const entries = [];
  let current = null;

  for (const raw of buffer) {
    const line = raw.trim();
    if (!line) {
      if (current && (current.meta.length || current.bullets.length)) {
        entries.push(current);
        current = null;
      }
      continue;
    }
    if (!current) current = { meta: [], bullets: [] };

    if (/^[•\-*]\s*/.test(line)) {
      current.bullets.push(line.replace(/^[•\-*]\s*/, ""));
    } else {
      current.meta.push(line);
    }
  }
  if (current && (current.meta.length || current.bullets.length)) {
    entries.push(current);
  }
  return entries;
}

function parseEducation(buffer) {
  const entries = [];
  let current = null;

  for (const raw of buffer) {
    const line = raw.trim();
    if (!line) {
      if (current && current.meta.length) {
        entries.push(current);
        current = null;
      }
      continue;
    }
    if (!current) current = { meta: [], bullets: [] };

    if (/^[•\-*]\s*/.test(line)) {
      current.bullets.push(line.replace(/^[•\-*]\s*/, ""));
    } else {
      current.meta.push(line);
    }
  }
  if (current && current.meta.length) entries.push(current);
  return entries;
}

// --- Building ------------------------------------------------------------

function buildDocxBlob(resumeText, photoArrayBuffer) {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    Table,
    TableRow,
    TableCell,
    WidthType,
    BorderStyle,
    ImageRun,
    convertInchesToTwip,
  } = window.docx;

  const parsed = parseResumeText(resumeText);
  const sections = parsed.sections;

  const noBorder = {
    top: { style: BorderStyle.NONE },
    bottom: { style: BorderStyle.NONE },
    left: { style: BorderStyle.NONE },
    right: { style: BorderStyle.NONE },
    insideHorizontal: { style: BorderStyle.NONE },
    insideVertical: { style: BorderStyle.NONE },
  };

  function heading(text) {
    return new Paragraph({
      spacing: { before: 200, after: 40 },
      border: { bottom: { color: "B8C4B6", space: 1, style: BorderStyle.SINGLE, size: 6 } },
      children: [
        new TextRun({
          text: text.charAt(0).toUpperCase() + text.slice(1).toLowerCase(),
          bold: true,
          color: COLOR_PRIMARY,
          size: 24, // 12pt
        }),
      ],
    });
  }

  function bullet(text, size = 20) {
    return new Paragraph({
      spacing: { after: 40 },
      indent: { left: convertInchesToTwip(0.2), hanging: convertInchesToTwip(0.15) },
      children: [
        new TextRun({ text: "•  " + text, size, color: COLOR_TEXT }),
      ],
    });
  }

  function body(text, { size = 20, italic = false, bold = false, color = COLOR_TEXT, spacingAfter = 60 } = {}) {
    return new Paragraph({
      spacing: { after: spacingAfter },
      children: [new TextRun({ text, size, italic, bold, color })],
    });
  }

  function spacer() {
    return new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: "", size: 8 })] });
  }

  // --- Sidebar (left column) content
  const leftChildren = [];
  if (sections.SKILLS) {
    leftChildren.push(heading("Skills"));
    sections.SKILLS.forEach((s) => leftChildren.push(bullet(s)));
  }
  if (sections.EDUCATION) {
    leftChildren.push(heading("Education"));
    sections.EDUCATION.forEach((entry) => {
      entry.meta.forEach((line, idx) => {
        if (idx === 0) leftChildren.push(body(line, { bold: true, spacingAfter: 0 }));
        else leftChildren.push(body(line, { size: 18, color: COLOR_MUTED, spacingAfter: 0 }));
      });
      entry.bullets.forEach((b) => leftChildren.push(bullet(b, 18)));
      leftChildren.push(spacer());
    });
  }
  if (sections.CERTIFICATIONS) {
    leftChildren.push(heading("Certifications"));
    sections.CERTIFICATIONS.forEach((c) => leftChildren.push(bullet(c)));
  }
  if (sections.INTERESTS) {
    leftChildren.push(heading("Interests"));
    sections.INTERESTS.forEach((c) => leftChildren.push(bullet(c)));
  }
  if (leftChildren.length === 0) leftChildren.push(new Paragraph({}));

  // --- Main (right column) content
  const rightChildren = [];
  if (sections.SUMMARY) {
    rightChildren.push(heading("Summary"));
    rightChildren.push(body(sections.SUMMARY));
  }

  function renderExperienceLike(title, entries) {
    rightChildren.push(heading(title));
    entries.forEach((entry) => {
      if (entry.meta[0]) rightChildren.push(body(entry.meta[0], { bold: true, size: 22, spacingAfter: 0 }));
      if (entry.meta.length > 1) {
        rightChildren.push(
          body(entry.meta.slice(1).join("  |  "), { size: 18, italic: true, color: COLOR_MUTED, spacingAfter: 40 })
        );
      }
      entry.bullets.forEach((b) => rightChildren.push(bullet(b)));
      rightChildren.push(spacer());
    });
  }

  if (sections.EXPERIENCE) renderExperienceLike("Experience", sections.EXPERIENCE);
  if (sections.PROJECTS) renderExperienceLike("Projects", sections.PROJECTS);
  if (rightChildren.length === 0) rightChildren.push(new Paragraph({}));

  // --- Header block (name, title, contact, optional photo)
  const headerParagraphs = [
    new Paragraph({
      spacing: { after: 0 },
      children: [new TextRun({ text: parsed.name, bold: true, size: 44, color: COLOR_PRIMARY })],
    }),
  ];
  if (parsed.title) {
    headerParagraphs.push(
      new Paragraph({
        spacing: { after: 40 },
        children: [new TextRun({ text: parsed.title, size: 24, color: COLOR_MUTED })],
      })
    );
  }
  if (parsed.contact.length) {
    headerParagraphs.push(
      new Paragraph({
        spacing: { after: 80 },
        children: [new TextRun({ text: parsed.contact.join("   |   "), size: 18, color: COLOR_MUTED })],
      })
    );
  }

  const docChildren = [];

  if (photoArrayBuffer) {
    const photoTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: noBorder,
      columnWidths: [1300, 6200],
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: 1300, type: WidthType.DXA },
              margins: { right: 120 },
              children: [
                new Paragraph({
                  children: [
                    new ImageRun({
                      data: photoArrayBuffer,
                      transformation: { width: 90, height: 90 },
                    }),
                  ],
                }),
              ],
            }),
            new TableCell({
              width: { size: 6200, type: WidthType.DXA },
              children: headerParagraphs,
            }),
          ],
        }),
      ],
    });
    docChildren.push(photoTable);
  } else {
    docChildren.push(...headerParagraphs);
  }

  // Rule under header
  docChildren.push(
    new Paragraph({
      spacing: { after: 120 },
      border: { bottom: { color: COLOR_RULE, space: 1, style: BorderStyle.SINGLE, size: 16 } },
      children: [new TextRun({ text: "" })],
    })
  );

  // Two column body table
  const bodyTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorder,
    columnWidths: [2300, 5200],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 2300, type: WidthType.DXA },
            margins: { right: 180 },
            children: leftChildren,
          }),
          new TableCell({
            width: { size: 5200, type: WidthType.DXA },
            margins: { left: 180 },
            children: rightChildren,
          }),
        ],
      }),
    ],
  });
  docChildren.push(bodyTable);

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: convertInchesToTwip(8.27), height: convertInchesToTwip(11.69) },
            margin: {
              top: convertInchesToTwip(0.6),
              bottom: convertInchesToTwip(0.6),
              left: convertInchesToTwip(0.6),
              right: convertInchesToTwip(0.6),
            },
          },
        },
        children: docChildren,
      },
    ],
  });

  return Packer.toBlob(doc);
}

// --- Public entry point -----------------------------------------------

/**
 * Generates and triggers download of the tailored resume as a .docx file.
 * @param {string} resumeText - the rewritten resume plain text
 * @param {File|null} photoFile - optional image file for the header
 */
async function exportResumeAsDocx(resumeText, photoFile) {
  let photoBuffer = null;
  if (photoFile) {
    photoBuffer = await photoFile.arrayBuffer();
  }

  const blob = await buildDocxBlob(resumeText, photoBuffer);

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "tailored_resume.docx";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

window.exportResumeAsDocx = exportResumeAsDocx;
