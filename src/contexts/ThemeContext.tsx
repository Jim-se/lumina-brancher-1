import React, { createContext, useContext, useState, useEffect } from 'react';

export type ThemeType = 'chatgpt' | 'claude';
export type ThemeMode = 'light' | 'dark';

interface ThemeContextType {
    theme: ThemeType;
    mode: ThemeMode;
    setTheme: (theme: ThemeType) => void;
    setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [theme, setTheme] = useState<ThemeType>(() => {
        return (localStorage.getItem('lumina-theme') as ThemeType) || 'chatgpt';
    });
    const [mode, setMode] = useState<ThemeMode>(() => {
        return (localStorage.getItem('lumina-mode') as ThemeMode) || 'light';
    });

    useEffect(() => {
        localStorage.setItem('lumina-theme', theme);
        localStorage.setItem('lumina-mode', mode);

        // Set data attributes on html element for CSS targeting
        const root = document.documentElement;
        root.setAttribute('data-theme', theme);
        root.setAttribute('data-mode', mode);

        // For Tailwind's dark mode if enabled
        if (mode === 'dark') {
            root.classList.add('dark');
        } else {
            root.classList.remove('dark');
        }
    }, [theme, mode]);

    return (
        <ThemeContext.Provider value={{ theme, mode, setTheme, setMode }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
};
