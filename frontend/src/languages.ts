export type Language = "C" | "CPP" | "JAVA" | "PYTHON";

export const LANGUAGE_INFO: Record<Language, { label: string; monaco: string; filename: string }> = {
  C: { label: "C", monaco: "c", filename: "main.c" },
  CPP: { label: "C++", monaco: "cpp", filename: "main.cpp" },
  JAVA: { label: "Java", monaco: "java", filename: "Main.java" },
  PYTHON: { label: "Python", monaco: "python", filename: "main.py" },
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
