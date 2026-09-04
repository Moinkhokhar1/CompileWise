export type Language = "C" | "CPP" | "JAVA" | "PYTHON";

export interface LanguageConfig {
  sourceFile: string;
  monacoLanguage: string;
  displayName: string;
  needsCompile: boolean;
  compileCommand: string[];
  runCommand: string[];
}

export const LANGUAGE_CONFIG: Record<Language, LanguageConfig> = {
  C: {
    sourceFile: "main.c",
    monacoLanguage: "c",
    displayName: "C",
    needsCompile: true,
    compileCommand: [
      "gcc", "-fdiagnostics-format=json", "-Wall", "-Wextra",
      "-o", "/work/a.out", "/work/main.c",
    ],
    runCommand: ["stdbuf", "-o0", "/work/a.out"],
  },
  CPP: {
    sourceFile: "main.cpp",
    monacoLanguage: "cpp",
    displayName: "C++",
    needsCompile: true,
    compileCommand: [
      "g++", "-fdiagnostics-format=json", "-Wall", "-Wextra",
      "-o", "/work/a.out", "/work/main.cpp",
    ],
    runCommand: ["stdbuf", "-o0", "/work/a.out"],
  },
  JAVA: {
    sourceFile: "Main.java",
    monacoLanguage: "java",
    displayName: "Java",
    needsCompile: true,
    compileCommand: ["javac", "Main.java"],
    runCommand: ["stdbuf", "-o0", "java", "Main"],
  },
  PYTHON: {
    sourceFile: "main.py",
    monacoLanguage: "python",
    displayName: "Python",
    needsCompile: true,
    compileCommand: ["python3", "-m", "py_compile", "/work/main.py"],
    runCommand: ["python3", "-u", "/work/main.py"],
  },
};

export const STARTER_TEMPLATES: Record<Language, string> = {
  C: `#include <stdio.h>

int main() {
    
    return 0;
}
`,
  CPP: `#include <iostream>
using namespace std;

int main() {
    
    return 0;
}
`,
  JAVA: `public class Main {
    public static void main(String[] args) {
        
    }
}
`,
  PYTHON: `# Write your code here

`,
};

export function isLanguage(value: string): value is Language {
  return value in LANGUAGE_CONFIG;
}
