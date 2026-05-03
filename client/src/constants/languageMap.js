/**
 * constants/languageMap.js
 * Maps Monaco editor language IDs → Piston runtime slugs + file metadata.
 *
 * Monaco ID     : used by the Monaco editor's language prop
 * pistonSlug    : used in Piston API requests (must match Piston runtime name)
 * label         : human-readable name shown in the UI
 * icon          : short badge text shown in language selector
 * defaultFile   : default filename hint passed to Piston
 */
export const LANGUAGE_MAP = {
    javascript: {
        pistonSlug: 'javascript',
        label: 'JavaScript',
        icon: 'JS',
        defaultFile: 'main.js',
        monacoId: 'javascript',
    },
    typescript: {
        pistonSlug: 'typescript',
        label: 'TypeScript',
        icon: 'TS',
        defaultFile: 'main.ts',
        monacoId: 'typescript',
    },
    python: {
        pistonSlug: 'python',
        label: 'Python',
        icon: 'PY',
        defaultFile: 'main.py',
        monacoId: 'python',
    },
    java: {
        pistonSlug: 'java',
        label: 'Java',
        icon: 'JAVA',
        defaultFile: 'Main.java',
        monacoId: 'java',
    },
    cpp: {
        pistonSlug: 'c++',
        label: 'C++',
        icon: 'C++',
        defaultFile: 'main.cpp',
        monacoId: 'cpp',
    },
    c: {
        pistonSlug: 'c',
        label: 'C',
        icon: 'C',
        defaultFile: 'main.c',
        monacoId: 'c',
    },
    rust: {
        pistonSlug: 'rust',
        label: 'Rust',
        icon: 'RS',
        defaultFile: 'main.rs',
        monacoId: 'rust',
    },
    go: {
        pistonSlug: 'go',
        label: 'Go',
        icon: 'GO',
        defaultFile: 'main.go',
        monacoId: 'go',
    },
    ruby: {
        pistonSlug: 'ruby',
        label: 'Ruby',
        icon: 'RB',
        defaultFile: 'main.rb',
        monacoId: 'ruby',
    },
    php: {
        pistonSlug: 'php',
        label: 'PHP',
        icon: 'PHP',
        defaultFile: 'main.php',
        monacoId: 'php',
    },
    swift: {
        pistonSlug: 'swift',
        label: 'Swift',
        icon: 'SW',
        defaultFile: 'main.swift',
        monacoId: 'swift',
    },
    kotlin: {
        pistonSlug: 'kotlin',
        label: 'Kotlin',
        icon: 'KT',
        defaultFile: 'main.kt',
        monacoId: 'kotlin',
    },
    csharp: {
        pistonSlug: 'csharp',
        label: 'C#',
        icon: 'C#',
        defaultFile: 'main.cs',
        monacoId: 'csharp',
    },
    bash: {
        pistonSlug: 'bash',
        label: 'Bash',
        icon: 'SH',
        defaultFile: 'main.sh',
        monacoId: 'shell',
    },
    // Non-executable (no Piston support — Run button will be disabled)
    html: {
        pistonSlug: null,
        label: 'HTML',
        icon: 'HTML',
        defaultFile: 'index.html',
        monacoId: 'html',
    },
    css: {
        pistonSlug: null,
        label: 'CSS',
        icon: 'CSS',
        defaultFile: 'styles.css',
        monacoId: 'css',
    },
    json: {
        pistonSlug: null,
        label: 'JSON',
        icon: 'JSON',
        defaultFile: 'data.json',
        monacoId: 'json',
    },
    markdown: {
        pistonSlug: null,
        label: 'Markdown',
        icon: 'MD',
        defaultFile: 'README.md',
        monacoId: 'markdown',
    },
};

/** Ordered list for the language selector dropdown */
export const LANGUAGES = Object.entries(LANGUAGE_MAP).map(([id, meta]) => ({
    id,
    ...meta,
}));

/** Whether a language supports code execution via Piston */
export function isExecutable(monacoLanguageId) {
    return !!LANGUAGE_MAP[monacoLanguageId]?.pistonSlug;
}

/** Get the Piston slug for a Monaco language ID */
export function getPistonSlug(monacoLanguageId) {
    return LANGUAGE_MAP[monacoLanguageId]?.pistonSlug ?? null;
}
