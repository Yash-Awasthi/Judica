import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { AuthRequest } from "../types/index.js";

const storage = multer.diskStorage({
  destination: (req: any, _file, cb) => {
    const userId = (req as AuthRequest).userId || "anonymous";
    const date = new Date().toISOString().split("T")[0];
    const dir = path.join(process.cwd(), "uploads", String(userId), date);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const unique = crypto.randomBytes(8).toString("hex");
    const ext = path.extname(file.originalname);
    cb(null, `${unique}${ext}`);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});
