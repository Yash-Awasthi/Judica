import { Router } from "express";
import { TEMPLATES } from "../lib/templates.js";

const router = Router();

router.get("/", (req, res) => {
  res.json(TEMPLATES);
});

router.get("/:id", (req, res) => {
  const template = TEMPLATES.find(t => t.id === req.params.id);
  if (!template) {
    res.status(404).json({ error: "Template not found" });
    return;
  }
  res.json(template);
});

export default router;