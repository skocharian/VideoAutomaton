import template916 from "../creatomate/template-9x16-underwater-styled.json";

type TemplateElement = Record<string, unknown> & {
  name: string;
};

type TemplateDocument = {
  width: number;
  height: number;
  elements: TemplateElement[];
};

const template = template916 as TemplateDocument;

const elementsByName = Object.fromEntries(
  template.elements.map((element) => [element.name, element])
) as Record<string, TemplateElement>;

export const TEMPLATE_9X16_WIDTH = template.width;
export const TEMPLATE_9X16_HEIGHT = template.height;

export function getTemplateElementLayout(name: string): TemplateElement | undefined {
  return elementsByName[name];
}
