import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

interface Props {
  lat: number;
  lon: number;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function AdvisoryChat({ lat, lon }: Props) {
  const navigate = useNavigate();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content:
        'Welcome to KrishiDisha AI Advisory! I have access to real-time farm data — weather, soil, groundwater, and ozone conditions.\n\nJust tell me which crop you\'re interested in (e.g. "I want to grow rice" or "Compare wheat and maize") and I\'ll run simulations and give you advice.',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [contextSummary, setContextSummary] = useState<string | null>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Reset chat when location changes
  useEffect(() => {
    setMessages([{
      role: 'assistant',
      content:
        'Welcome to KrishiDisha AI Advisory! I have access to real-time farm data — weather, soil, groundwater, and ozone conditions.\n\nJust tell me which crop you\'re interested in (e.g. "I want to grow rice" or "Compare wheat and maize") and I\'ll run simulations and give you advice.',
    }]);
    setContextSummary(null);
    fetch('/api/advisory/reset', { method: 'POST' }).catch(() => {});
  }, [lat, lon]);

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

      if (data.context_summary && !contextSummary) {
        setContextSummary(data.context_summary);
      }

      const assistantMsg: Message = {
        role: 'assistant',
        content: data.response ?? data.message ?? 'Advisory service coming soon.',
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: 'Advisory service is not yet connected. Coming soon — AI-powered agricultural advisory with context from your weather data, soil profile, crop simulations, and ozone analysis.',
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section id="advisory" className="accent-slate">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <h2 style={{ margin: 0 }}>AI Farm Advisory</h2>
        <button onClick={() => navigate('/analysis')} style={{
          background: '#e8f5e9', color: '#2e7d32', border: '1px solid #a5d6a7', borderRadius: 6,
          padding: '6px 14px', fontSize: '0.82rem', cursor: 'pointer',
        }}>&larr; Farm Analysis</button>
      </div>

      {/* Context indicator */}
      <div style={{
        background: '#e8f5e9', padding: '8px 12px', borderRadius: '6px',
        fontSize: '0.8rem', color: '#2e7d32', marginBottom: '0.75rem',
        display: 'flex', alignItems: 'center', gap: '6px',
      }}>
        <span style={{ fontSize: '1rem' }}>🌾</span>
        <span>
          <strong>AI has context:</strong>{' '}
          {contextSummary
            ? contextSummary
            : `${lat.toFixed(2)}°N, ${lon.toFixed(2)}°E — weather, soil, groundwater, ozone data. Tell me which crop to analyze.`
          }
        </span>
      </div>

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
              textAlign: 'left', whiteSpace: 'pre-wrap',
            }}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ color: '#999', fontStyle: 'italic' }}>Thinking...</div>
        )}
        <div ref={chatEndRef} />
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="e.g. &quot;I want to grow rice on 2 hectares&quot; or &quot;Best crop for dry soil?&quot;"
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
