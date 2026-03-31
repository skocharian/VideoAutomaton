import template916 from "../creatomate/template-9x16-underwater-styled.json";
import template45 from "../creatomate/template-4x5-underwater-styled.json";

type TemplateElement = Record<string, unknown> & {
  name: string;
};

type TemplateDocument = {
  width: number;
  height: number;
  elements: TemplateElement[];
};

type SupportedTemplateSize = "9:16" | "4:5";

const templates = {
  "9:16": template916 as TemplateDocument,
  "4:5": template45 as TemplateDocument,
} satisfies Record<SupportedTemplateSize, TemplateDocument>;

const elementsBySize = Object.fromEntries(
  Object.entries(templates).map(([size, template]) => [
    size,
    Object.fromEntries(
      template.elements.map((element) => [element.name, element])
    ) as Record<string, TemplateElement>,
  ])
) as Record<SupportedTemplateSize, Record<string, TemplateElement>>;

export function getTemplateDimensions(size: string): {
  width: number;
  height: number;
} {
  const template = resolveTemplate(size);
  return {
    width: template.width,
    height: template.height,
  };
}

export function getTemplateElementLayout(
  name: string,
  size: string = "9:16"
): TemplateElement | undefined {
  return elementsBySize[resolveTemplateSize(size)][name];
}

function resolveTemplate(size: string): TemplateDocument {
  return templates[resolveTemplateSize(size)];
}

function resolveTemplateSize(size: string): SupportedTemplateSize {
  return size === "4:5" ? "4:5" : "9:16";
}
