import { useEffect, useMemo, useRef, useState } from 'react'
import './App.scss'

type Entry = { removed: boolean, original: string, guess?: string, guessed?: boolean };


function QuizLine({ text, percentage, minLength }: { text: string, percentage: number, minLength: number }) {
  const words = text.split(' ');

  const [_, setRerenderHack] = useState(Math.random());
  const entriesRef = useRef<Entry[]>();
  useEffect(() => {
    entriesRef.current = [];
    let includeNext = true;
    const symbols = ['.', ',', '!', ';', ',', 'ξ', ':'];
    for (const word of words) {
      if (includeNext && word.trim().length > minLength && Math.random() < percentage) {
        const startingSymbol = symbols.find(s => word.startsWith(s));
        const endingSymbol = symbols.find(s => word.endsWith(s));
        if (startingSymbol) {
          entriesRef.current.push({ removed: false, original: startingSymbol });
          entriesRef.current.push({ removed: true, original: word.slice(1) });
        } else if (endingSymbol) {
          entriesRef.current.push({ removed: true, original: word.slice(0, word.length - 1) });
          entriesRef.current.push({ removed: false, original: endingSymbol });
        } else {
          entriesRef.current.push({ removed: true, original: word });
        }
        
        includeNext = false;
      } else {
        entriesRef.current.push({ removed: false, original: word });
        includeNext = true;
      }
    }
    setRerenderHack(Math.random());
  }, []);

  return <p>
    { entriesRef.current && entriesRef.current.map((entry, i) => (entry.removed && !entry.guessed) ?
      <input key={i} style={{width: `${entry.original.length*0.5}em` }} defaultValue='' onChange={e => {
        entriesRef.current![i].guess = e.target.value;
      }} onKeyDown={e => {
        if (e.key === 'Enter') {
          entriesRef.current![i].guessed = true;
          setRerenderHack(Math.random());
        }
      }}/> :
      entry.guessed
        ? <span
          key={i}
          className={entry.guess?.trim().toLocaleLowerCase() === entry.original?.trim().toLocaleLowerCase() ? 'green' : 'red'}
        >{entry.original}</span>
        : <span key={i}>{entry.original}</span>) }
  </p>;
}

function App() {
  const [text, setText] = useState('');
  const [quizzing, setQuizzing] = useState(false);
  const [percentage, setPercentage] = useState('0.2');
  const [minLength, setMinLength] = useState('5');


  return <div className='app'>
    { !quizzing && <>
      <textarea value={text} onChange={e => setText(e.target.value)}/>
      <label>
        Percentage: <input value={percentage} onChange={e => setPercentage(e.target.value)} />  
      </label>
      <label>
        Min length: <input value={minLength} onChange={e => setMinLength(e.target.value)}/>  
      </label>
      <button onClick={() => setQuizzing(true)}>Start quiz</button>
    </>}
    { quizzing && text.split('\n').map((line, i) => <QuizLine key={i} percentage={parseFloat(percentage)} minLength={parseInt(minLength)} text={line}/>) }
  </div>
}

export default App
