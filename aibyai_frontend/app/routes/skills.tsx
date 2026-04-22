import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Wrench, Search, Code } from "lucide-react";

interface Skill {
  id: string;
  name: string;
  description: string;
  language: "Python" | "TypeScript" | "JavaScript";
  tags: string[];
  code: string;
}

const mockSkills: Skill[] = [
  {
    id: "sk_1",
    name: "Web Scraper",
    description: "Extract structured data from web pages using CSS selectors and XPath",
    language: "Python",
    tags: ["scraping", "data"],
    code: "import requests\nfrom bs4 import BeautifulSoup\n\ndef scrape_page(url: str, selector: str) -> list[str]:\n    resp = requests.get(url)\n    soup = BeautifulSoup(resp.text, 'html.parser')\n    return [el.text for el in soup.select(selector)]",
  },
  {
    id: "sk_2",
    name: "JSON Transformer",
    description: "Transform JSON data between different schemas using JMESPath expressions",
    language: "TypeScript",
    tags: ["data", "transform"],
    code: "import jmespath from 'jmespath';\n\nexport function transform(data: unknown, expression: string): unknown {\n  return jmespath.search(data, expression);\n}",
  },
  {
    id: "sk_3",
    name: "PDF Parser",
    description: "Extract text and metadata from PDF documents",
    language: "Python",
    tags: ["documents", "parsing"],
    code: "import PyPDF2\n\ndef extract_text(pdf_path: str) -> str:\n    reader = PyPDF2.PdfReader(pdf_path)\n    return '\\n'.join(page.extract_text() for page in reader.pages)",
  },
  {
    id: "sk_4",
    name: "API Client Generator",
    description: "Generate typed API client code from OpenAPI specifications",
    language: "TypeScript",
    tags: ["api", "codegen"],
    code: "import { generateClient } from './codegen';\n\nexport async function generateFromSpec(specUrl: string) {\n  const spec = await fetch(specUrl).then(r => r.json());\n  return generateClient(spec);\n}",
  },
  {
    id: "sk_5",
    name: "SQL Query Builder",
    description: "Build parameterized SQL queries with a fluent API",
    language: "TypeScript",
    tags: ["database", "sql"],
    code: "export class QueryBuilder {\n  private parts: string[] = [];\n  select(...cols: string[]) { this.parts.push(`SELECT ${cols.join(', ')}`); return this; }\n  from(table: string) { this.parts.push(`FROM ${table}`); return this; }\n  where(condition: string) { this.parts.push(`WHERE ${condition}`); return this; }\n  build() { return this.parts.join(' '); }\n}",
  },
  {
    id: "sk_6",
    name: "Image Analyzer",
    description: "Analyze images using computer vision for object detection and classification",
    language: "Python",
    tags: ["vision", "ai"],
    code: "from PIL import Image\nimport torch\nfrom transformers import pipeline\n\ndef analyze_image(image_path: str) -> dict:\n    classifier = pipeline('image-classification')\n    image = Image.open(image_path)\n    return classifier(image)",
  },
];

const languageColors: Record<Skill["language"], string> = {
  Python: "text-blue-400 border-blue-400/30 bg-blue-400/10",
  TypeScript: "text-sky-400 border-sky-400/30 bg-sky-400/10",
  JavaScript: "text-yellow-400 border-yellow-400/30 bg-yellow-400/10",
};

export default function SkillsPage() {
  const [search, setSearch] = useState("");
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);

  const filtered = mockSkills.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase()) ||
      s.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Wrench className="size-6 text-muted-foreground" />
          <div>
            <h1 className="text-xl font-semibold">Skills</h1>
            <p className="text-sm text-muted-foreground">
              Reusable code snippets and functions available to AI agents
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search skills..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((skill) => (
            <Card
              key={skill.id}
              className="cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all"
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-sm">{skill.name}</CardTitle>
                  <Badge
                    variant="outline"
                    className={`text-[10px] shrink-0 ${languageColors[skill.language]}`}
                  >
                    {skill.language}
                  </Badge>
                </div>
                <CardDescription className="text-xs">{skill.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-1">
                  {skill.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-[10px]">
                      {tag}
                    </Badge>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-2 text-xs"
                  onClick={() => setSelectedSkill(skill)}
                >
                  <Code className="size-3" />
                  View Code
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">
            No skills match your search.
          </div>
        )}
      </div>

      {/* Code Dialog */}
      <Dialog open={!!selectedSkill} onOpenChange={(open) => !open && setSelectedSkill(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Code className="size-4" />
              {selectedSkill?.name}
              {selectedSkill && (
                <Badge
                  variant="outline"
                  className={`text-[10px] ml-2 ${languageColors[selectedSkill.language]}`}
                >
                  {selectedSkill.language}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          {selectedSkill && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{selectedSkill.description}</p>
              <div className="rounded-md bg-zinc-950 border border-zinc-800 overflow-auto max-h-96">
                <pre className="p-4 text-xs font-mono text-zinc-100 leading-relaxed whitespace-pre">
                  <code>{selectedSkill.code}</code>
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
