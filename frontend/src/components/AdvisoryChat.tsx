import { useState, useEffect } from 'react';
import { getCrops } from '../services/api';

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
      content: 'Welcome to KrishiTwin AI Advisory. I have access to your real-time farm data — weather, soil, groundwater, and ozone conditions. Ask me about crop selection, irrigation, pest management, or climate adaptation.',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [contextSummary, setContextSummary] = useState<string | null>(null);
  const [crops, setCrops] = useState<Record<string, string>>({});
  const [selectedCrop, setSelectedCrop] = useState('wheat');

  useEffect(() => {
    getCrops().then((c) => setCrops(c.crops)).catch(() => {});
  }, []);

  // Reset chat when location changes
  useEffect(() => {
    setMessages([{
      role: 'assistant',
      content: 'Welcome to KrishiTwin AI Advisory. I have access to your real-time farm data — weather, soil, groundwater, and ozone conditions. Ask me about crop selection, irrigation, pest management, or climate adaptation.',
    }]);
    setContextSummary(null);
    // Reset backend conversation history
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
        body: JSON.stringify({ message: input.trim(), latitude: lat, longitude: lon, crop: selectedCrop }),
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
        content: 'Advisory service is not yet connected. Coming soon — Claude AI-powered agricultural advisory with context from your weather data, soil profile, crop simulations, and ozone analysis.',
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section id="advisory" className="accent-slate">
      <h2>AI Farm Advisory</h2>

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
            : `${lat.toFixed(2)}°N, ${lon.toFixed(2)}°E, ${selectedCrop} — weather, soil, models`
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

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <select
          value={selectedCrop}
          onChange={(e) => setSelectedCrop(e.target.value)}
          style={{ padding: '0.5rem', borderRadius: '8px', border: '1px solid #ccc', fontSize: '0.85rem' }}
        >
          {Object.keys(crops).length > 0
            ? Object.keys(crops).map((c) => (
                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
              ))
            : <option value="wheat">Wheat</option>
          }
        </select>
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
