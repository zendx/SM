import express from "express";
import multer from "multer";
import PDFDocument from "pdfkit";
import { inflateSync } from "node:zlib";
import { one, audit } from "./db.js";
import { fail, requirePermission } from "./security.js";

export function logoBuffer(school) {
  return school?.logo_data
    ? Buffer.from(school.logo_data.split(",")[1], "base64")
    : null;
}
export function drawSchoolLogo(doc, school) {
  const image = logoBuffer(school);
  if (!image) return;
  const x = doc.page.margins.left,
    y = doc.y;
  doc.image(image, x, y, { fit: [100, 60] });
  doc.x = x;
  doc.y = y + 70;
}
export function schoolBrandingRoutes(db) {
  const r = express.Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 256 * 1024, files: 1, fields: 0 },
  });
  for (const kind of ["logo", "signature"]) {
    r.post(
      `/school/${kind}`,
      requirePermission("admin.write"),
      upload.single(kind),
      async (req, res) => {
        if (!req.user.school_id)
          fail(403, `Open a school portal to manage its ${kind}.`);
        const b = req.file?.buffer;
        let mime;
        if (b?.subarray(0, 8).toString("hex") === "89504e470d0a1a0a")
          mime = "image/png";
        else if (b?.subarray(0, 3).toString("hex") === "ffd8ff")
          mime = "image/jpeg";
        else fail(422, `Choose a PNG or JPEG ${kind}, up to 256 KB.`);
        try {
          const probe = new PDFDocument({ autoFirstPage: false });
          const image = probe.openImage(b);
          if (
            image.width > 2048 ||
            image.height > 2048 ||
            image.width < 1 ||
            image.height < 1
          )
            throw Error();
          if (mime === "image/png") {
            // Validate compressed pixels synchronously before PDFKit's async PNG decoder.
            const png = image.image;
            const pixels = inflateSync(Buffer.from(png.imgData), {
              maxOutputLength: 40 * 1024 * 1024,
            });
            const passes =
              png.interlaceMethod === 1
                ? [
                    [0, 0, 8, 8],
                    [4, 0, 8, 8],
                    [0, 4, 4, 8],
                    [2, 0, 4, 4],
                    [0, 2, 2, 4],
                    [1, 0, 2, 2],
                    [0, 1, 1, 2],
                  ]
                : [[0, 0, 1, 1]];
            let pos = 0;
            for (const [x, y, dx, dy] of passes) {
              const w = Math.max(0, Math.ceil((png.width - x) / dx)),
                h = Math.max(0, Math.ceil((png.height - y) / dy));
              if (!w || !h) continue;
              const rowBytes = Math.ceil((w * png.pixelBitlength) / 8);
              for (let row = 0; row < h; row++) {
                if (pos >= pixels.length || pixels[pos] > 4) throw Error();
                pos += rowBytes + 1;
              }
            }
            if (pos !== pixels.length) throw Error();
          } else if (b.subarray(-2).toString("hex") !== "ffd9") throw Error();
          probe.addPage();
          probe.image(image, 0, 0, { fit: [100, 60] });
          probe.resume();
          probe.end();
        } catch {
          fail(
            422,
            `Use a valid PNG or JPEG ${kind}, no larger than 2048 by 2048 pixels.`,
          );
        }
        const school = await one(
          db,
          `UPDATE schools SET ${kind}_data=$2 WHERE id=$1 RETURNING id,name,${kind}_data`,
          [req.user.school_id, `data:${mime};base64,${b.toString("base64")}`],
        );
        await audit(
          db,
          req.user,
          "schools",
          school.id,
          `${kind.toUpperCase()}_UPDATED`,
        );
        res.json({ data: school });
      },
    );
    r.delete(
      `/school/${kind}`,
      requirePermission("admin.write"),
      async (req, res) => {
        await db.query(`UPDATE schools SET ${kind}_data='' WHERE id=$1`, [
          req.user.school_id,
        ]);
        await audit(
          db,
          req.user,
          "schools",
          req.user.school_id,
          `${kind.toUpperCase()}_REMOVED`,
        );
        res.json({ data: { ok: true } });
      },
    );
  }
  return r;
}

export function drawAdministratorSignature(doc, school) {
  if (!school?.signature_data) return;
  if (doc.y > doc.page.height - doc.page.margins.bottom - 100) doc.addPage();
  const x = doc.page.margins.left,
    y = doc.y + 10;
  doc.image(Buffer.from(school.signature_data.split(",")[1], "base64"), x, y, {
    fit: [150, 60],
  });
  doc.fontSize(10).text("Administrator signature", x, y + 65);
}
