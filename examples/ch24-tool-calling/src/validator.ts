// Tool argument validation against JSON schema.
// Ensures tool calls match their declared schema before execution.
//
// Validation happens BEFORE sanitization. Invalid calls are rejected
// without even attempting to sanitize them.

import type {
  JsonSchema,
  PropertySchema,
  ToolDefinition,
  ValidationError,
  ValidationResult,
} from './types.ts';

/**
 * ToolValidator checks tool call arguments against the tool schema.
 */
export class ToolValidator {
  private tools: Map<string, ToolDefinition>;

  constructor(tools: ToolDefinition[]) {
    this.tools = new Map();
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
    }
  }

  /**
   * Get a tool definition by name.
   */
  getTool(name: string): ToolDefinition | null {
    return this.tools.get(name) ?? null;
  }

  /**
   * Validate tool call arguments.
   */
  validate(
    toolName: string,
    args: Record<string, unknown>
  ): ValidationResult {
    const tool = this.tools.get(toolName);

    if (!tool) {
      return {
        valid: false,
        errors: [
          {
            path: '',
            message: `Unknown tool: ${toolName}`,
            code: 'invalid_value',
          },
        ],
      };
    }

    return this.validateObject(args, tool.parameters, '');
  }

  /**
   * Validate an object against a JSON schema.
   */
  private validateObject(
    obj: Record<string, unknown>,
    schema: JsonSchema,
    path: string
  ): ValidationResult {
    const errors: ValidationError[] = [];

    // Check required properties
    if (schema.required) {
      for (const required of schema.required) {
        if (!(required in obj) || obj[required] === undefined) {
          errors.push({
            path: path ? `${path}.${required}` : required,
            message: `Missing required property: ${required}`,
            code: 'missing_required',
          });
        }
      }
    }

    // Check each property
    for (const [key, value] of Object.entries(obj)) {
      const propPath = path ? `${path}.${key}` : key;
      const propSchema = schema.properties[key];

      // Check for extra properties
      if (!propSchema) {
        if (schema.additionalProperties === false) {
          errors.push({
            path: propPath,
            message: `Unexpected property: ${key}`,
            code: 'extra_property',
          });
        }
        continue;
      }

      // Validate the property
      const propErrors = this.validateProperty(value, propSchema, propPath);
      errors.push(...propErrors);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate a single property against its schema.
   */
  private validateProperty(
    value: unknown,
    schema: PropertySchema,
    path: string
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    // Type check
    const actualType = this.getType(value);
    if (actualType !== schema.type) {
      errors.push({
        path,
        message: `Expected ${schema.type}, got ${actualType}`,
        code: 'invalid_type',
      });
      return errors; // Don't validate further if type is wrong
    }

    // String validations
    if (schema.type === 'string' && typeof value === 'string') {
      if (schema.enum && !schema.enum.includes(value)) {
        errors.push({
          path,
          message: `Value must be one of: ${schema.enum.join(', ')}`,
          code: 'invalid_value',
        });
      }

      if (schema.pattern) {
        const regex = new RegExp(schema.pattern);
        if (!regex.test(value)) {
          errors.push({
            path,
            message: `Value does not match pattern: ${schema.pattern}`,
            code: 'invalid_value',
          });
        }
      }

      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push({
          path,
          message: `String too long: max ${schema.maxLength}, got ${value.length}`,
          code: 'invalid_value',
        });
      }
    }

    // Number validations
    if (schema.type === 'number' && typeof value === 'number') {
      if (schema.enum && !schema.enum.includes(value)) {
        errors.push({
          path,
          message: `Value must be one of: ${schema.enum.join(', ')}`,
          code: 'invalid_value',
        });
      }

      if (schema.minimum !== undefined && value < schema.minimum) {
        errors.push({
          path,
          message: `Value below minimum: ${schema.minimum}, got ${value}`,
          code: 'invalid_value',
        });
      }

      if (schema.maximum !== undefined && value > schema.maximum) {
        errors.push({
          path,
          message: `Value above maximum: ${schema.maximum}, got ${value}`,
          code: 'invalid_value',
        });
      }
    }

    // Array validations
    if (schema.type === 'array' && Array.isArray(value)) {
      if (schema.items) {
        for (let i = 0; i < value.length; i++) {
          const itemErrors = this.validateProperty(
            value[i],
            schema.items,
            `${path}[${i}]`
          );
          errors.push(...itemErrors);
        }
      }
    }

    return errors;
  }

  /**
   * Get the JSON schema type of a value.
   */
  private getType(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }
}
