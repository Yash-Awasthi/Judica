import { Router } from "express";
import { TEMPLATES } from "../lib/templates.js";

const router = Router();

/**
 * @openapi
 * /api/templates:
 *   get:
 *     tags:
 *       - Templates
 *     summary: List all prompt templates
 *     responses:
 *       200:
 *         description: Array of templates
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   name:
 *                     type: string
 *                   description:
 *                     type: string
 *                   prompt:
 *                     type: string
 */
router.get("/", (req, res) => {
  res.json(TEMPLATES);
});

/**
 * @openapi
 * /api/templates/{id}:
 *   get:
 *     tags:
 *       - Templates
 *     summary: Get a template by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Template ID
 *     responses:
 *       200:
 *         description: Template details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       404:
 *         description: Template not found
 */
router.get("/:id", (req, res) => {
  const template = TEMPLATES.find(t => t.id === req.params.id);
  if (!template) {
    res.status(404).json({ error: "Template not found" });
    return;
  }
  res.json(template);
});

export default router;
