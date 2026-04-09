import { Request, Response, NextFunction } from "express";
import { httpRequestDuration, httpRequestTotal } from "../lib/prometheusMetrics.js";

export function prometheusMiddleware(req: Request, res: Response, next: NextFunction) {
  const end = httpRequestDuration.startTimer();

  res.on("finish", () => {
    const route = req.route?.path || req.path;
    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode),
    };
    end(labels);
    httpRequestTotal.inc(labels);
  });

  next();
}
