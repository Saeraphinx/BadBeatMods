import { defineConfig, globalIgnores } from "eslint/config";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

export default defineConfig([globalIgnores(["**/node_modules/", "**/build/", "**/storage/"]), {
    extends: compat.extends("eslint:recommended", "plugin:@typescript-eslint/recommended"),

    plugins: {
        "@typescript-eslint": typescriptEslint,
    },

    languageOptions: {
        globals: {
            ...globals.browser,
        },

        parser: tsParser,
        ecmaVersion: 2024,
        sourceType: "module",
    },

    rules: {
        "no-console": "error",
        semi: ["warn", "always"],
        quotes: ["warn", "backtick"],

        "arrow-spacing": ["warn", {
            before: true,
            after: true,
        }],

        "brace-style": ["error", "1tbs", {
            allowSingleLine: true,
        }],

        "comma-dangle": ["off"],
        "comma-spacing": "error",
        "comma-style": "error",
        curly: ["error", "multi-line", "consistent"],
        "dot-location": ["error", "property"],
        "handle-callback-err": "off",

        indent: ["error", 4, {
            SwitchCase: 1,
        }],

        "keyword-spacing": "error",

        "max-nested-callbacks": ["error", {
            max: 4,
        }],

        "max-statements-per-line": ["error", {
            max: 2,
        }],

        "no-empty-function": "warn",
        "no-floating-decimal": "error",
        "no-inline-comments": "off",
        "no-lonely-if": "off",
        "no-multi-spaces": "error",

        "no-multiple-empty-lines": ["error", {
            max: 2,
            maxEOF: 1,
            maxBOF: 0,
        }],

        "no-shadow": ["off", {
            allow: ["err", "resolve", "reject", "user", "guild", "role", "message"],
        }],

        "no-trailing-spaces": ["warn", {
            skipBlankLines: true,
        }],

        "no-case-declarations": "off",
        "no-var": "error",
        "object-curly-spacing": ["off", "always"],
        "prefer-const": "off",
        "space-before-blocks": "error",

        "space-before-function-paren": ["error", {
            anonymous: "never",
            named: "never",
            asyncArrow: "always",
        }],

        "no-useless-assignment": "warn",
        "space-in-parens": "error",
        "space-infix-ops": "error",
        "space-unary-ops": "error",
        "spaced-comment": "off",
        yoda: "error",
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-unused-vars": "warn",
        "@typescript-eslint/no-unused-expressions": "warn",
    },
}]);