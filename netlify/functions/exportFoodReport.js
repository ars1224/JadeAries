const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const { isAdminAuthorized } = require("./lib/adminAuth");
const { query } = require("./lib/database");
const { buildFoodReport } = require("./lib/foodReport");
const { json, methodNotAllowed } = require("./lib/http");

const BRAND = {
  rose: "#c96582",
  sage: "#607c58",
  sageWash: "#eef3e9",
  cream: "#fbf8ef",
  line: "#e6d7c3",
  text: "#4b4844",
  muted: "#77716a",
};

function reportDate(date) {
  return new Intl.DateTimeFormat("en-NZ", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Pacific/Auckland",
  }).format(date);
}

function fileDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Pacific/Auckland",
  }).format(date);
}

function currency(value) {
  return new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "NZD",
  }).format(Number(value || 0));
}

function excelCellResult(cell) {
  return typeof cell.value === "object" && cell.value?.result !== undefined
    ? cell.value.result
    : cell.value;
}

async function createExcel(report) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Jhon Aries & Charmie Jade";
  workbook.created = report.generatedAt;
  workbook.modified = report.generatedAt;
  workbook.calcProperties.fullCalcOnLoad = true;

  const sheet = workbook.addWorksheet("Food orders", {
    properties: { defaultRowHeight: 20 },
    views: [{ state: "frozen", ySplit: 7, showGridLines: false }],
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
  });

  sheet.columns = [
    { key: "category", width: 13 },
    { key: "item", width: 42 },
    { key: "codes", width: 16 },
    { key: "price", width: 17 },
    { key: "quantity", width: 12 },
    { key: "subtotal", width: 18 },
    { key: "guests", width: 34 },
    { key: "notes", width: 36 },
  ];

  sheet.getCell("A1").value = "Food orders";
  sheet.getCell("A1").font = {
    name: "Arial",
    size: 16,
    bold: true,
    color: { argb: "FFC96582" },
  };
  sheet.getCell("A2").value =
    `Jhon Aries & Charmie Jade | Private catering report | Generated ${reportDate(report.generatedAt)}`;
  sheet.getCell("A2").font = {
    name: "Arial",
    size: 9,
    italic: true,
    color: { argb: "FF77716A" },
  };

  const summary = [
    ["A4", "Main orders", "A5", report.mainCount],
    ["C4", "Dessert orders", "C5", report.dessertCount],
    ["E4", "Combined total", "E5", report.grandTotal],
  ];
  summary.forEach(([labelCell, label, valueCell, value]) => {
    sheet.getCell(labelCell).value = label;
    sheet.getCell(labelCell).font = {
      name: "Arial",
      size: 9,
      bold: true,
      color: { argb: "FF607C58" },
    };
    sheet.getCell(valueCell).value = value;
    sheet.getCell(valueCell).font = {
      name: "Arial",
      size: 13,
      bold: true,
      color: { argb: "FFC96582" },
    };
  });
  sheet.getCell("E5").numFmt = '"$"#,##0.00';

  const headerRow = sheet.getRow(7);
  headerRow.values = [
    "Category",
    "Menu item",
    "Dietary codes",
    "Unit price (NZD)",
    "Orders",
    "Subtotal (NZD)",
    "Ordered by",
    "Guest dietary requirements",
  ];
  headerRow.height = 30;
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF607C58" } };
    cell.font = { name: "Arial", size: 9, bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: "FFFFFFFF" } } };
  });

  let rowNumber = 8;
  const sectionTotalRows = [];
  report.sections.forEach((section) => {
    const firstItemRow = rowNumber;
    section.items.forEach((item) => {
      const row = sheet.getRow(rowNumber);
      const orderedBy = item.orders.length
        ? item.orders.map((order) => order.name).join("\n")
        : "No orders yet";
      const dietaryNotes = item.orders
        .filter((order) => order.dietaryRequirements)
        .map((order) => `${order.name}: ${order.dietaryRequirements}`)
        .join("\n") || "None recorded";

      row.values = [
        section.title,
        `${item.name}\n${item.description}`,
        item.dietaryCodes.length ? item.dietaryCodes.join(", ") : "-",
        item.unitPrice,
        item.quantity,
        null,
        orderedBy,
        dietaryNotes,
      ];
      row.getCell(6).value = {
        formula: `D${rowNumber}*E${rowNumber}`,
        result: item.subtotal,
      };
      row.height = Math.max(44, 16 + Math.max(item.orders.length, 1) * 15);
      row.eachCell((cell, columnNumber) => {
        cell.font = { name: "Arial", size: 9, color: { argb: "FF4B4844" } };
        cell.alignment = {
          horizontal: columnNumber >= 3 && columnNumber <= 6 ? "center" : "left",
          vertical: "top",
          wrapText: true,
        };
        cell.border = { bottom: { style: "thin", color: { argb: "FFE6D7C3" } } };
        if (rowNumber % 2 === 0) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFBF8EF" } };
        }
      });
      row.getCell(4).numFmt = '"$"#,##0.00';
      row.getCell(5).numFmt = "#,##0";
      row.getCell(6).numFmt = '"$"#,##0.00';
      rowNumber += 1;
    });

    const totalRow = sheet.getRow(rowNumber);
    totalRow.getCell(2).value = `${section.title} total`;
    totalRow.getCell(5).value = {
      formula: `SUM(E${firstItemRow}:E${rowNumber - 1})`,
      result: section.quantity,
    };
    totalRow.getCell(6).value = {
      formula: `SUM(F${firstItemRow}:F${rowNumber - 1})`,
      result: section.total,
    };
    totalRow.height = 26;
    totalRow.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF3E9" } };
      cell.font = { name: "Arial", size: 9, bold: true, color: { argb: "FF607C58" } };
      cell.alignment = { vertical: "middle" };
      cell.border = { bottom: { style: "medium", color: { argb: "FF607C58" } } };
    });
    totalRow.getCell(5).numFmt = "#,##0";
    totalRow.getCell(6).numFmt = '"$"#,##0.00';
    sectionTotalRows.push(rowNumber);
    rowNumber += 1;
  });

  sheet.getCell("E5").value = {
    formula: `SUM(${sectionTotalRows.map((row) => `F${row}`).join(",")})`,
    result: report.grandTotal,
  };
  sheet.autoFilter = { from: "A7", to: `H${rowNumber - 1}` };

  const buffer = await workbook.xlsx.writeBuffer();
  if (excelCellResult(sheet.getCell("E5")) !== report.grandTotal) {
    throw new Error("The Excel report total did not reconcile.");
  }
  return Buffer.from(buffer);
}

function pdfText(value) {
  return String(value || "")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');
}

function createPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margins: { top: 38, right: 42, bottom: 48, left: 42 },
      bufferPages: true,
      info: {
        Title: "Food orders",
        Author: "Jhon Aries & Charmie Jade",
        Subject: "Private catering report",
      },
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    function addPageHeading(continued = false) {
      doc.font("Times-Bold").fontSize(continued ? 18 : 25).fillColor(BRAND.rose);
      doc.text(continued ? "Food orders (continued)" : "Food orders", { lineGap: 2 });
      doc.font("Helvetica").fontSize(8.5).fillColor(BRAND.muted);
      doc.text(
        `Jhon Aries & Charmie Jade | Private catering report | Generated ${reportDate(report.generatedAt)}`
      );
      doc.moveDown(1.1);
    }

    function ensureSpace(height) {
      if (doc.y + height <= doc.page.height - doc.page.margins.bottom - 16) {
        return;
      }
      doc.addPage();
      addPageHeading(true);
    }

    addPageHeading(false);
    const summaryY = doc.y;
    const boxGap = 12;
    const boxWidth = (contentWidth - boxGap * 2) / 3;
    [
      ["Main orders", report.mainCount],
      ["Dessert orders", report.dessertCount],
      ["Combined total (NZD)", currency(report.grandTotal)],
    ].forEach(([label, value], index) => {
      const x = doc.page.margins.left + index * (boxWidth + boxGap);
      doc.roundedRect(x, summaryY, boxWidth, 54, 7).fillAndStroke(BRAND.sageWash, "#cbd4c3");
      doc.font("Helvetica-Bold").fontSize(7).fillColor(BRAND.sage).text(
        label.toUpperCase(),
        x + 12,
        summaryY + 10,
        { width: boxWidth - 24 }
      );
      doc.font("Times-Bold").fontSize(19).fillColor(BRAND.rose).text(
        String(value),
        x + 12,
        summaryY + 25,
        { width: boxWidth - 24 }
      );
    });
    doc.y = summaryY + 72;

    report.sections.forEach((section) => {
      ensureSpace(44);
      const sectionY = doc.y;
      doc.font("Times-Bold").fontSize(18).fillColor(BRAND.rose).text(section.title);
      doc.font("Helvetica-Bold").fontSize(8).fillColor(BRAND.sage).text(
        `${section.quantity} orders | ${currency(section.total)}`,
        doc.page.margins.left,
        sectionY + 5,
        { width: contentWidth, align: "right" }
      );
      doc.moveTo(doc.page.margins.left, doc.y + 3)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y + 3)
        .strokeColor(BRAND.line)
        .stroke();
      doc.moveDown(1.1);

      section.items.forEach((item) => {
        const guestText = item.orders.length
          ? item.orders.map((order) => order.name).join(", ")
          : "No orders yet";
        const notesText = item.orders
          .filter((order) => order.dietaryRequirements)
          .map((order) => `${order.name}: ${order.dietaryRequirements}`)
          .join("; ") || "None recorded";
        const detail = `${pdfText(item.description)} | Dietary codes: ${item.dietaryCodes.join(", ") || "-"}`;
        const cardHeight = 62
          + doc.heightOfString(pdfText(guestText), { width: contentWidth - 22 })
          + doc.heightOfString(pdfText(notesText), { width: contentWidth - 22 });
        ensureSpace(cardHeight);
        const cardY = doc.y;
        doc.roundedRect(doc.page.margins.left, cardY, contentWidth, cardHeight - 7, 6)
          .fillAndStroke(BRAND.cream, BRAND.line);
        doc.font("Times-Bold").fontSize(12).fillColor(BRAND.text).text(
          pdfText(item.name),
          doc.page.margins.left + 11,
          cardY + 9,
          { width: contentWidth - 255 }
        );
        doc.font("Helvetica-Bold").fontSize(8.5).fillColor(BRAND.sage).text(
          `${currency(item.unitPrice)} each | ${item.quantity} order${item.quantity === 1 ? "" : "s"} | ${currency(item.subtotal)}`,
          doc.page.width - doc.page.margins.right - 230,
          cardY + 11,
          { width: 219, align: "right" }
        );
        doc.font("Helvetica").fontSize(7.7).fillColor(BRAND.muted).text(
          detail,
          doc.page.margins.left + 11,
          cardY + 27,
          { width: contentWidth - 22 }
        );
        doc.font("Helvetica-Bold").fontSize(7.5).fillColor(BRAND.sage).text(
          "ORDERED BY",
          doc.page.margins.left + 11,
          doc.y + 7,
          { continued: true }
        );
        doc.font("Helvetica").fillColor(BRAND.text).text(`  ${pdfText(guestText)}`);
        doc.font("Helvetica-Bold").fillColor(BRAND.sage).text(
          "GUEST DIETARY REQUIREMENTS",
          doc.page.margins.left + 11,
          doc.y + 4,
          { continued: true }
        );
        doc.font("Helvetica").fillColor(BRAND.text).text(`  ${pdfText(notesText)}`);
        doc.y = cardY + cardHeight;
      });
      doc.moveDown(0.35);
    });

    const pageRange = doc.bufferedPageRange();
    for (let pageIndex = pageRange.start; pageIndex < pageRange.start + pageRange.count; pageIndex += 1) {
      doc.switchToPage(pageIndex);
      doc.font("Helvetica").fontSize(7).fillColor(BRAND.muted).text(
        `Private admin report | Page ${pageIndex - pageRange.start + 1} of ${pageRange.count}`,
        doc.page.margins.left,
        doc.page.height - doc.page.margins.bottom - 10,
        { width: contentWidth, align: "center", lineBreak: false }
      );
    }

    doc.end();
  });
}

exports.handler = async (event) => {
  if (!isAdminAuthorized(event)) {
    return json(401, { error: "Invalid admin password." });
  }

  if (event.httpMethod !== "GET") {
    return methodNotAllowed("GET");
  }

  const format = String(event.queryStringParameters?.format || "").toLowerCase();
  if (!new Set(["pdf", "xlsx"]).has(format)) {
    return json(400, { error: "Choose either pdf or xlsx format." });
  }

  try {
    const result = await query(
      `SELECT full_name, rsvp_status, meal_choice, dessert_choice, dietary_requirements
       FROM guests
       WHERE rsvp_status = 'attending'
       ORDER BY LOWER(full_name)`
    );
    const report = buildFoodReport(result.rows);
    const output = format === "pdf" ? await createPdf(report) : await createExcel(report);
    const filename = `food-orders-${fileDate(report.generatedAt)}.${format}`;

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": format === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      body: output.toString("base64"),
    };
  } catch (error) {
    console.error("Food report export failed", error);
    return json(500, { error: "The food report could not be generated right now." });
  }
};

module.exports.createExcel = createExcel;
module.exports.createPdf = createPdf;
