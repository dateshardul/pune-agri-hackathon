import { useState } from 'react';

interface Props {
  lat: number;
  lon: number;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function AdvisoryChat({ lat, lon }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'Welcome to KrishiTwin AI Advisory. I can help with crop selection, irrigation scheduling, pest management, and climate adaptation strategies for your farm. What would you like to know?',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMsg: Message = { role: 'user', content: input.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/advisory/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: input.trim(), latitude: lat, longitude: lon }),
      });
      const data = await res.json();

      const assistantMsg: Message = {
        role: 'assistant',
        content: data.response ?? data.message ?? 'Advisory service coming soon. This will be powered by Claude AI with access to your farm data, weather forecasts, and crop simulation results.',
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: 'Advisory service is not yet connected. Coming soon — Claude AI-powered agricultural advisory with context from your weather data, soil profile, crop simulations, and ozone analysis.',
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section>
      <h2>AI Farm Advisory</h2>

      <div style={{
        background: '#fff', borderRadius: '8px', padding: '1rem',
        maxHeight: '400px', overflowY: 'auto', marginBottom: '0.75rem',
      }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            marginBottom: '0.75rem',
            textAlign: m.role === 'user' ? 'right' : 'left',
          }}>
            <div style={{
              display: 'inline-block', maxWidth: '80%',
              padding: '0.5rem 0.75rem', borderRadius: '12px',
              background: m.role === 'user' ? '#1976d2' : '#e8e8e8',
              color: m.role === 'user' ? '#fff' : '#333',
              textAlign: 'left',
            }}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ color: '#999', fontStyle: 'italic' }}>Thinking...</div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="Ask about crops, weather, soil, irrigation..."
          style={{
            flex: 1, padding: '0.5rem 0.75rem', borderRadius: '8px',
            border: '1px solid #ccc', fontSize: '0.95rem',
          }}
        />
        <button onClick={sendMessage} disabled={loading}
          style={{ padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer' }}>
          Send
        </button>
      </div>
    </section>
  );
}
