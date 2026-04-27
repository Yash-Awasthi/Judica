import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted DB mock ──────────────────────────────────────────────────────────
const {
  mockDbSelect,
  mockDbInsert,
  mockDbUpdate,
  mockDbDelete,
  mockSelectFrom,
  mockDeleteReturning,
} = vi.hoisted(() => {
  const mockDeleteReturning = vi.fn().mockResolvedValue([]);
  const mockDeleteWhere = vi.fn().mockImplementation(() => {
    const p = Promise.resolve([]);
    return Object.assign(p, { returning: mockDeleteReturning });
  });
  const mockDbDelete = vi.fn().mockReturnValue({ where: mockDeleteWhere });

  const mockInsertReturning = vi.fn().mockResolvedValue([]);
  const mockInsertValues = vi.fn().mockReturnValue({ returning: mockInsertReturning });
  const mockDbInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

  const mockUpdateReturning = vi.fn().mockResolvedValue([]);
  const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
  const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
  const mockDbUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

  const mockSelectLimit = vi.fn().mockResolvedValue([]);
  const mockSelectWhere = vi.fn().mockReturnValue({ limit: mockSelectLimit });
  const mockSelectFrom = vi.fn().mockReturnValue({ where: mockSelectWhere });
  const mockDbSelect = vi.fn().mockReturnValue({ from: mockSelectFrom });

  return {
    mockDbSelect,
    mockDbInsert,
    mockDbUpdate,
    mockDbDelete,
    mockSelectFrom,
    mockDeleteReturning,
  };
});

vi.mock("../../src/lib/drizzle.js", () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
    delete: mockDbDelete,
  },
}));
vi.mock("../../src/db/schema/whitelabel.js", () => ({
  tenantBranding: { tenantId: "tenantId", customDomain: "customDomain" },
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: true, a, b })),
}));
vi.mock("../../src/lib/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
  },
}));

import {
  getBranding,
  upsertBranding,
  deleteBranding,
  resolveBrandingForDomain,
} from "../../src/services/whitelabel.service.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sampleBranding = {
  id: "branding-1",
  tenantId: "tenant-abc",
  customDomain: "example.com",
  logoUrl: null,
  primaryColor: "#ffffff",
  updatedAt: new Date(),
  createdAt: new Date(),
};

function resetSelectToReturn(rows: unknown[]) {
  const mockSelectLimit = vi.fn().mockResolvedValue(rows);
  const mockSelectWhere = vi.fn().mockReturnValue({ limit: mockSelectLimit });
  mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
}

// ─── getBranding ──────────────────────────────────────────────────────────────

describe("getBranding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSelectToReturn([]);
  });

  it("returns null when no branding row exists for the tenantId", async () => {
    const result = await getBranding("tenant-xyz");
    expect(result).toBeNull();
  });

  it("returns the row when branding is found", async () => {
    resetSelectToReturn([sampleBranding]);
    const result = await getBranding("tenant-abc");
    expect(result).toEqual(sampleBranding);
  });

  it("calls db.select and chains from/where/limit correctly", async () => {
    resetSelectToReturn([sampleBranding]);
    await getBranding("tenant-abc");
    expect(mockDbSelect).toHaveBeenCalledOnce();
    expect(mockSelectFrom).toHaveBeenCalledOnce();
  });
});

// ─── upsertBranding ───────────────────────────────────────────────────────────

describe("upsertBranding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls insert when getBranding returns null (no existing record)", async () => {
    // getBranding → null
    resetSelectToReturn([]);
    const newRecord = { ...sampleBranding, id: "branding-new" };
    const mockInsertReturning = vi.fn().mockResolvedValue([newRecord]);
    const mockInsertValues = vi.fn().mockReturnValue({ returning: mockInsertReturning });
    mockDbInsert.mockReturnValue({ values: mockInsertValues });

    const result = await upsertBranding("tenant-abc", { primaryColor: "#000" });

    expect(mockDbInsert).toHaveBeenCalledOnce();
    expect(result).toEqual(newRecord);
  });

  it("calls update when getBranding returns an existing record", async () => {
    // getBranding → existing row
    resetSelectToReturn([sampleBranding]);
    const updatedRecord = { ...sampleBranding, primaryColor: "#ff0000" };
    const mockUpdateReturning = vi.fn().mockResolvedValue([updatedRecord]);
    const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
    const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
    mockDbUpdate.mockReturnValue({ set: mockUpdateSet });

    const result = await upsertBranding("tenant-abc", { primaryColor: "#ff0000" });

    expect(mockDbUpdate).toHaveBeenCalledOnce();
    expect(result).toEqual(updatedRecord);
  });

  it("does not call update when record does not exist", async () => {
    resetSelectToReturn([]);
    const mockInsertReturning = vi.fn().mockResolvedValue([sampleBranding]);
    const mockInsertValues = vi.fn().mockReturnValue({ returning: mockInsertReturning });
    mockDbInsert.mockReturnValue({ values: mockInsertValues });

    await upsertBranding("tenant-abc", {});

    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("does not call insert when record already exists", async () => {
    resetSelectToReturn([sampleBranding]);
    const mockUpdateReturning = vi.fn().mockResolvedValue([sampleBranding]);
    const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
    const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
    mockDbUpdate.mockReturnValue({ set: mockUpdateSet });

    await upsertBranding("tenant-abc", {});

    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("returns the created record on insert path", async () => {
    resetSelectToReturn([]);
    const created = { ...sampleBranding, id: "created-id" };
    const mockInsertReturning = vi.fn().mockResolvedValue([created]);
    const mockInsertValues = vi.fn().mockReturnValue({ returning: mockInsertReturning });
    mockDbInsert.mockReturnValue({ values: mockInsertValues });

    const result = await upsertBranding("tenant-new", { logoUrl: "https://logo.png" });

    expect(result).toEqual(created);
  });

  it("returns the updated record on update path", async () => {
    resetSelectToReturn([sampleBranding]);
    const updated = { ...sampleBranding, logoUrl: "https://new-logo.png" };
    const mockUpdateReturning = vi.fn().mockResolvedValue([updated]);
    const mockUpdateWhere = vi.fn().mockReturnValue({ returning: mockUpdateReturning });
    const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
    mockDbUpdate.mockReturnValue({ set: mockUpdateSet });

    const result = await upsertBranding("tenant-abc", { logoUrl: "https://new-logo.png" });

    expect(result).toEqual(updated);
  });
});

// ─── deleteBranding ───────────────────────────────────────────────────────────

describe("deleteBranding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when a row is deleted", async () => {
    mockDeleteReturning.mockResolvedValue([sampleBranding]);
    const result = await deleteBranding("tenant-abc");
    expect(result).toBe(true);
  });

  it("returns false when no row was found to delete", async () => {
    mockDeleteReturning.mockResolvedValue([]);
    const result = await deleteBranding("tenant-xyz");
    expect(result).toBe(false);
  });

  it("calls db.delete once", async () => {
    mockDeleteReturning.mockResolvedValue([]);
    await deleteBranding("tenant-abc");
    expect(mockDbDelete).toHaveBeenCalledOnce();
  });
});

// ─── resolveBrandingForDomain ─────────────────────────────────────────────────

describe("resolveBrandingForDomain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSelectToReturn([]);
  });

  it("returns null for an unknown domain", async () => {
    const result = await resolveBrandingForDomain("unknown.example.com");
    expect(result).toBeNull();
  });

  it("returns the branding row when a matching domain is found", async () => {
    resetSelectToReturn([sampleBranding]);
    const result = await resolveBrandingForDomain("example.com");
    expect(result).toEqual(sampleBranding);
  });

  it("calls db.select once for the domain lookup", async () => {
    await resolveBrandingForDomain("example.com");
    expect(mockDbSelect).toHaveBeenCalledOnce();
  });
});
