import glob from 'fast-glob';
import fuzzy from 'fuzzy';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { useEffect, useState } from 'react';

type SmartInputProps = {
  onSubmit: (value: string, contextFiles: string[]) => void;
  placeholder?: string;
};

type Mode = 'text' | 'command' | 'context';

const COMMANDS = ['/clear', '/dashboard', '/help', '/quit'];

export function SmartInput({ onSubmit, placeholder }: SmartInputProps) {
  const [input, setInput] = useState('');
  const [contextFiles, setContextFiles] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<Mode>('text');
  const [allFiles, setAllFiles] = useState<string[]>([]);

  // Load files on mount
  useEffect(() => {
    glob('**/*', {
      ignore: ['node_modules/**', '.git/**', 'dist/**'],
      onlyFiles: true,
      cwd: process.cwd(),
    }).then(setAllFiles);
  }, []);

  // Update suggestions based on input
  useEffect(() => {
    const lastWord = input.split(' ').pop() || '';

    if (lastWord.startsWith('/')) {
      setMode('command');
      const matches = fuzzy.filter(lastWord, COMMANDS).map((el) => el.string);
      setSuggestions(matches);
      setSelectedIndex(0);
    } else if (lastWord.startsWith('@')) {
      setMode('context');
      const query = lastWord.slice(1);
      const matches = fuzzy
        .filter(query, allFiles)
        .map((el) => el.string)
        .slice(0, 5);
      setSuggestions(matches);
      setSelectedIndex(0);
    } else {
      setMode('text');
      setSuggestions([]);
    }
  }, [input, allFiles]);

  useInput((_key, inputData) => {
    if (mode === 'text') return;

    if (inputData.upArrow) {
      setSelectedIndex(Math.max(0, selectedIndex - 1));
    }
    if (inputData.downArrow) {
      setSelectedIndex(Math.min(suggestions.length - 1, selectedIndex + 1));
    }
    if (inputData.return || inputData.tab) {
      if (suggestions[selectedIndex]) {
        const words = input.split(' ');
        words.pop(); // remove incomplete trigger

        if (mode === 'context') {
          const file = suggestions[selectedIndex];
          if (!contextFiles.includes(file)) {
            setContextFiles([...contextFiles, file]);
          }
          // Don't add file text to input, just add to context state
          setInput(`${words.join(' ')} `);
        } else if (mode === 'command') {
          setInput(`${suggestions[selectedIndex]} `);
        }
      }
    }
  });

  const handleSubmit = (value: string) => {
    onSubmit(value, contextFiles);
    setInput('');
    setContextFiles([]);
  };

  return (
    <Box flexDirection="column" width="100%">
      {/* Context Chips */}
      {contextFiles.length > 0 && (
        <Box marginBottom={0} flexWrap="wrap">
          {contextFiles.map((file) => (
            <Box
              key={file}
              borderStyle="round"
              borderColor="blue"
              marginRight={1}
              paddingX={1}
            >
              <Text color="blue">@{file}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Suggestion Popup */}
      {suggestions.length > 0 && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          position="absolute"
          marginTop={-1 * (suggestions.length + 2)}
          marginLeft={2}
        >
          {suggestions.map((s, i) => (
            <Text key={s} color={i === selectedIndex ? 'cyan' : 'gray'}>
              {i === selectedIndex ? '> ' : '  '}
              {s}
            </Text>
          ))}
        </Box>
      )}

      {/* Input Field */}
      <Box
        borderStyle="round"
        borderColor={mode === 'text' ? 'green' : 'cyan'}
        paddingX={1}
      >
        <Text color={mode === 'text' ? 'green' : 'cyan'}>
          {mode === 'command' ? 'CMD ' : mode === 'context' ? 'CTX ' : '❯ '}
        </Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder={placeholder}
        />
      </Box>
    </Box>
  );
}
