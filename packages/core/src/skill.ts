import {
  defineTool,
  type ToolDefinition,
  type ToolRunRequest,
} from "./tool.js";
import type { JsonObject, JsonSchema, JsonValue } from "./types.js";

export interface SkillManifest {
  name: string;
  description: string;
  version?: string;
  inputSchema: JsonSchema;
  tags?: string[];
  metadata?: JsonObject;
}

export interface Skill extends SkillManifest {
  run(request: ToolRunRequest): Promise<JsonValue> | JsonValue;
}

export function defineSkill(skill: Skill): Skill {
  defineTool(skill);
  return skill;
}

export function skillToTool(skill: Skill): ToolDefinition {
  return {
    name: skill.name,
    description: skill.description,
    inputSchema: skill.inputSchema,
    run: skill.run,
  };
}
