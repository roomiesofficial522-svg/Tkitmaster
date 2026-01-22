import { useState, useEffect, useCallback } from 'react';
import { Clock, AlertCircle, Check, X, Zap, TrendingUp, Trash2, RotateCcw } from 'lucide-react';
import { Toaster, toast } from 'sonner';

type SeatState = 'available' | 'selected' | 'booked' | 'locked';
type SeatTier = 'vip' | 'premium' | 'standard';

interface Seat {
  id: string;
  row: string;
  number: number;
  state: SeatState;
  tier: SeatTier;
  price: number;
  lockedBy?: number;
  ttl?: number;
}

interface LogEntry {
  id: number;
  timestamp: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
}

const ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
const SEATS_PER_ROW = 10;
const BOOKING_TIME_LIMIT = 300; 

const TIER_CONFIG: Record<SeatTier, { price: number; color: string; glowColor: string; label: string }> = {
  vip: { price: 12000, color: 'border-yellow-500', glowColor: 'shadow-yellow-500/50', label: 'VIP' },
  premium: { price: 8000, color: 'border-purple-500', glowColor: 'shadow-purple-500/50', label: 'Premium' },
  standard: { price: 5000, color: 'border-blue-500', glowColor: 'shadow-blue-500/50', label: 'Standard' },
};

const getTierForRow = (row: string): SeatTier => {
  if (['A', 'B'].includes(row)) return 'vip';
  if (['C', 'D', 'E', 'F'].includes(row)) return 'premium';
  return 'standard';
};

export default function App() {
  const [seats, setSeats] = useState<Seat[]>([]);
  const [selectedSeats, setSelectedSeats] = useState<string[]>([]);
  const [timeLeft, setTimeLeft] = useState(BOOKING_TIME_LIMIT);
  const [liveUsers, setLiveUsers] = useState(1420);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logCounter, setLogCounter] = useState(0);
  const [isBooking, setIsBooking] = useState(false);
  const [recentSoldCount, setRecentSoldCount] = useState(0);
  
  // NEW STATES
  const [devMode, setDevMode] = useState(false);
  const [shakingSeat, setShakingSeat] = useState<string | null>(null);
  const [isSessionExpired, setIsSessionExpired] = useState(false); 
  const [myUserId] = useState(() => Math.floor(Math.random() * 10000) + 1);

  // Initialize
  useEffect(() => {
    addLog(`System initialized. User ID: ${myUserId}`, 'success');
  }, [myUserId]);

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    setLogCounter((prev) => {
      const newId = prev + 1;
      setLogs((prevLogs) => {
        const newLog: LogEntry = {
          id: newId,
          timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
          message,
          type,
        };
        return [newLog, ...prevLogs].slice(0, 100);
      });
      return newId;
    });
  }, []);

  // Timer
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setIsSessionExpired(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 🔄 REAL-TIME SYNC ENGINE (High Frequency)
  useEffect(() => {
    const fetchStadium = async () => {
      try {
        const res = await fetch('http://localhost:3001/api/seats');
        const data = await res.json();
        
        if (data.seats) {
          const serverSeats: Seat[] = data.seats;
          
          setSeats((currentSeats) => {
             if (currentSeats.length === 0) return serverSeats;

             return serverSeats.map(serverSeat => {
                const currentSeat = currentSeats.find(s => s.id === serverSeat.id);
                
                // Preserve my selection if valid
                if (currentSeat?.state === 'selected' && serverSeat.state !== 'booked') {
                    return { ...serverSeat, state: 'selected', lockedBy: myUserId };
                }

                // Visual Masking: Locked by other -> Booked (Red)
                if (serverSeat.state === 'locked' && serverSeat.lockedBy !== myUserId) {
                    return { ...serverSeat, state: 'booked' };
                }

                return serverSeat;
             });
          });

          const sold = serverSeats.filter(s => s.state === 'booked').length;
          setRecentSoldCount(sold);
        }
      } catch (err) {
        // Silent fail
      }
    };

    fetchStadium();
    const interval = setInterval(fetchStadium, 500); 
    return () => clearInterval(interval);
  }, [myUserId]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleSeatClick = async (seatId: string) => {
    const seat = seats.find((s) => s.id === seatId);

    if (!seat || seat.state === 'booked') {
        setShakingSeat(seatId);
        setTimeout(() => setShakingSeat(null), 500);
        toast.error("Seat unavailable");
        return;
    }

    if (seat.state === 'locked' && seat.lockedBy !== myUserId) {
        setShakingSeat(seatId);
        setTimeout(() => setShakingSeat(null), 500);
        toast.error(`Seat ${seatId} is currently held by another user.`);
        return;
    }

    // DESELECT
    if (selectedSeats.includes(seatId)) {
        setSelectedSeats((prev) => prev.filter((id) => id !== seatId));
        setSeats((prev) => prev.map((s) => (s.id === seatId ? { ...s, state: 'available', lockedBy: undefined } : s)));
        
        await fetch('http://localhost:3001/api/release', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ seatId, userId: myUserId })
        });
        addLog(`Lock released for ${seatId}`, 'info');
        return;
    }

    // LOCK
    try {
        const response = await fetch('http://localhost:3001/api/lock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ seatId, userId: myUserId })
        });
        const data = await response.json();

        if (response.ok && data.success) {
            setSelectedSeats((prev) => [...prev, seatId]);
            setSeats((prev) => prev.map((s) => (s.id === seatId ? { ...s, state: 'selected', lockedBy: myUserId } : s))); 
            toast.success(`Seat Locked! 5:00 timer started.`);
        } else {
            setShakingSeat(seatId);
            setTimeout(() => setShakingSeat(null), 500);
            
            setSeats((prev) => prev.map((s) => (s.id === seatId ? { ...s, state: 'booked' } : s))); 
            toast.error("Too Slow! Seat just taken.");
        }
    } catch (error) {
        toast.error("Network Error");
    }
  };

  // ✅ FIX: MANUALLY UPDATE SEAT STATE TO 'AVAILABLE'
  const handleReset = async () => {
    // 1. Release all on server
    await Promise.all(selectedSeats.map(seatId => 
        fetch('http://localhost:3001/api/release', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ seatId, userId: myUserId })
        })
    ));

    // 2. FORCE UPDATE local state to 'available' immediately
    // This stops the polling logic from "preserving" the selection
    setSeats((prev) => prev.map((s) => 
        selectedSeats.includes(s.id) ? { ...s, state: 'available', lockedBy: undefined } : s
    ));

    // 3. Clear the checkout list
    setSelectedSeats([]);
    addLog('Selection cleared', 'info');
  };

  const handleBookNow = async () => {
    if (selectedSeats.length === 0) return;
    setIsBooking(true);
    const idempotencyKey = `cart_${myUserId}_${selectedSeats.join('_')}`;

    try {
      const response = await fetch('http://localhost:3001/api/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey,
          seatId: selectedSeats[0],
          userId: myUserId
        })
      });

      const data = await response.json();

      if (data.success) {
        setSeats((prev) => prev.map((s) => selectedSeats.includes(s.id) ? { ...s, state: 'booked' } : s));
        addLog(`✓ PAYMENT CONFIRMED: Tx ID ${data.txId}`, 'success');
        toast.success(`🎉 Booking Confirmed!`);
        setSelectedSeats([]);
      } else {
        toast.error(data.message || "Payment Failed");
        addLog(`> PAYMENT ERROR: ${data.message}`, 'error');
      }
    } catch (error) {
      toast.error("Network Error");
    } finally {
      setIsBooking(false);
    }
  };

  const handleResetDB = async () => {
    if(!confirm("⚠️ ARE YOU SURE? This will wipe the ENTIRE database.")) return;
    try {
        await fetch('http://localhost:3001/api/reset', { method: 'POST' });
        setSelectedSeats([]);
        toast.success("💥 Database Wiped");
        addLog("SYSTEM RESET EXECUTED", 'error');
    } catch (e) {
        toast.error("Reset failed");
    }
  };

  const handleRefreshSession = () => {
    window.location.reload();
  };

  const calculateTotal = () => selectedSeats.reduce((sum, id) => sum + (seats.find(s => s.id === id)?.price || 0), 0);
  
  const getSelectedSeatsByTier = () => {
    const breakdown: Record<SeatTier, string[]> = { vip: [], premium: [], standard: [] };
    selectedSeats.forEach((seatId) => {
      const seat = seats.find((s) => s.id === seatId);
      if (seat) breakdown[seat.tier].push(seatId);
    });
    return breakdown;
  };
  const totalPrice = calculateTotal();
  const seatBreakdown = getSelectedSeatsByTier();

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-6 overflow-hidden relative">
      <Toaster position="top-center" theme="dark" richColors />
      
      {/* SESSION EXPIRED OVERLAY */}
      {isSessionExpired && (
        <div className="absolute inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-red-500/50 rounded-2xl p-8 max-w-md w-full text-center shadow-2xl shadow-red-500/20">
                <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Clock className="w-8 h-8 text-red-500" />
                </div>
                <h2 className="text-3xl font-bold text-white mb-2">Session Expired</h2>
                <p className="text-gray-400 mb-8">
                    Your 5-minute booking window has closed. High-demand events require strict time limits to ensure fairness for all fans.
                </p>
                <button 
                    onClick={handleRefreshSession}
                    className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-3 px-6 rounded-xl flex items-center justify-center gap-2 transition-all"
                >
                    <RotateCcw className="w-5 h-5" />
                    Join Queue Again
                </button>
            </div>
        </div>
      )}

      {/* Header */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-4 md:p-6 shadow-2xl">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h1 className="text-3xl md:text-5xl font-black tracking-tight bg-gradient-to-r from-white via-blue-200 to-purple-300 bg-clip-text text-transparent mb-2">
                COLDPLAY: LIVE IN MUMBAI
              </h1>
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Zap className="w-4 h-4 text-yellow-500" />
                <span>DY Patil Stadium • March 15, 2026</span>
              </div>
            </div>
            
            <div className="flex items-center gap-3 md:gap-4">
              <div className="backdrop-blur-xl bg-white/5 border border-red-500/30 rounded-xl px-4 py-3 flex items-center gap-3 shadow-lg shadow-red-500/20">
                <div className="relative">
                  <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                  <div className="absolute inset-0 w-3 h-3 bg-red-500 rounded-full animate-ping"></div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 uppercase tracking-wider">Live Users</div>
                  <div className="text-xl md:text-2xl font-bold text-red-500 font-mono">
                    {liveUsers.toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="backdrop-blur-xl bg-white/5 border border-yellow-500/30 rounded-xl px-4 py-3 flex items-center gap-3 shadow-lg shadow-yellow-500/20">
                <Clock className={`w-6 h-6 ${isSessionExpired ? 'text-red-500' : 'text-yellow-500'}`} />
                <div>
                  <div className="text-xs text-gray-400 uppercase tracking-wider">Session Time</div>
                  <div className={`text-xl md:text-2xl font-bold font-mono ${isSessionExpired ? 'text-red-500' : timeLeft < 60 ? 'text-red-500 animate-pulse' : 'text-yellow-500'}`}>
                    {formatTime(timeLeft)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-[1800px] mx-auto grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-4 md:p-8 shadow-2xl">
            {/* Dev Mode Toggle */}
            <div className="flex justify-end mb-4">
                <div className="flex items-center gap-2 bg-black/40 px-3 py-1.5 rounded-full border border-white/10">
                    <span className="text-xs font-mono text-gray-400">DEV MODE</span>
                    <input 
                        type="checkbox" 
                        checked={devMode} 
                        onChange={(e) => setDevMode(e.target.checked)}
                        className="accent-green-500 w-4 h-4 cursor-pointer"
                    />
                </div>
            </div>

            <div className="mb-8">
              <div className="relative bg-gradient-to-b from-purple-600/30 to-pink-600/30 border border-purple-500/50 rounded-xl py-4 text-center overflow-hidden shadow-lg shadow-purple-500/30">
                <span className="relative text-2xl font-bold tracking-widest bg-gradient-to-r from-purple-300 to-pink-300 bg-clip-text text-transparent">
                  ⚡ STAGE ⚡
                </span>
              </div>
            </div>
            
            <div className="relative mb-6">
              <div className="grid grid-cols-10 gap-1">
                {seats.map((seat) => {
                const tierConfig = TIER_CONFIG[seat.tier];
                const isMyLock = seat.lockedBy === myUserId;
                const isAvailable = seat.state === 'available';
                const isBooked = seat.state === 'booked'; 
                const isSelected = selectedSeats.includes(seat.id) || isMyLock;
                const isShaking = shakingSeat === seat.id;

                return (
                  <button
                    key={seat.id}
                    onClick={() => handleSeatClick(seat.id)}
                    disabled={isBooked} 
                    className={`
                      h-7 md:h-9 rounded-md transition-all duration-200 text-xs font-mono relative flex items-center justify-center
                      ${isShaking ? 'animate-shake border-red-500 border-2' : ''}
                      
                      ${isAvailable ? `bg-white/5 border-2 ${tierConfig.color} hover:bg-gradient-to-br hover:shadow-lg ${tierConfig.glowColor} hover:scale-110` : ''}
                      ${isSelected ? 'bg-gradient-to-br from-cyan-500 to-blue-600 border-2 border-cyan-400 scale-105 shadow-lg shadow-cyan-500/50 z-10' : ''}
                      ${isBooked ? 'bg-red-950/40 border border-red-900/50 opacity-50 cursor-not-allowed' : ''}
                    `}
                  >
                    {!isSelected && !isBooked && !devMode && (
                        <span className={`font-bold text-[10px] ${seat.tier === 'vip' ? 'text-yellow-500' : 'text-gray-400'}`}>
                            {seat.id}
                        </span>
                    )}

                    {isSelected && <Check className="w-3 h-3 text-white" />}
                    {isBooked && !devMode && <X className="w-3 h-3 text-red-500" />}

                    {devMode && (
                        <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center z-20 pointer-events-none rounded-md">
                            <span className="text-[8px] text-green-400 leading-none mb-0.5">{seat.id}</span>
                            {seat.ttl ? (
                                <span className="text-[7px] text-yellow-400 leading-none">TTL:{seat.ttl}</span>
                            ) : (
                                <span className="text-[7px] text-gray-600 leading-none">--</span>
                            )}
                        </div>
                    )}
                  </button>
                );
              })}
              </div>
            </div>
            
          </div>
        </div>

        <div className="xl:col-span-1">
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-6 shadow-2xl sticky top-6">
            <h2 className="text-2xl font-bold mb-4 bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
              Checkout
            </h2>
            
            {/* Urgency Alert */}
            {recentSoldCount > 0 && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-2 animate-pulse">
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <div className="font-bold text-red-500">High Demand Alert!</div>
                  <div className="text-red-300">{recentSoldCount} seat(s) just sold out</div>
                </div>
              </div>
            )}
            
            {/* Selected Seats Breakdown */}
            <div className="mb-6">
              <div className="text-sm text-gray-400 mb-3 uppercase tracking-wider">Selected Seats</div>
              {selectedSeats.length === 0 ? (
                <div className="text-gray-500 italic text-center py-8 border border-dashed border-gray-700 rounded-lg">
                  No seats selected
                </div>
              ) : (
                <div className="space-y-3">
                  {Object.entries(seatBreakdown).map(([tier, seatIds]) => {
                    if (seatIds.length === 0) return null;
                    const tierConfig = TIER_CONFIG[tier as SeatTier];
                    return (
                      <div key={tier} className="bg-white/5 border border-white/10 rounded-lg p-3">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-sm font-semibold uppercase text-gray-300">{tierConfig.label}</span>
                          <span className="text-sm font-mono text-gray-400">{seatIds.length}x ₹{tierConfig.price.toLocaleString()}</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {seatIds.map((seatId) => (
                            <span
                              key={seatId}
                              className={`px-2 py-1 rounded-md text-xs font-mono font-bold border-2 ${tierConfig.color} bg-white/5`}
                            >
                              {seatId}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            
            {/* Total Price */}
            <div className="border-t border-white/20 pt-4 mb-6">
              <div className="flex justify-between items-center text-sm mb-2">
                <span className="text-gray-400">Subtotal</span>
                <span className="font-mono text-gray-300">₹ {totalPrice.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center text-sm mb-3">
                <span className="text-gray-400">Platform Fee</span>
                <span className="font-mono text-gray-300">₹ {Math.floor(totalPrice * 0.05).toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center text-2xl font-bold border-t border-white/20 pt-3">
                <span>Total</span>
                <span className="text-green-500 font-mono bg-gradient-to-r from-green-500 to-emerald-400 bg-clip-text text-transparent">
                  ₹ {Math.floor(totalPrice * 1.05).toLocaleString()}
                </span>
              </div>
            </div>
            
            {/* Action Buttons */}
            <button
              onClick={handleBookNow}
              disabled={selectedSeats.length === 0 || isBooking}
              className="w-full bg-gradient-to-r from-green-600 via-emerald-600 to-green-600 hover:from-green-500 hover:to-emerald-500 disabled:from-gray-700 disabled:to-gray-800 disabled:cursor-not-allowed py-4 px-6 rounded-xl font-bold text-lg mb-3 transition-all shadow-lg shadow-green-500/30 hover:shadow-green-500/50 hover:scale-105 flex items-center justify-center gap-2"
            >
              {isBooking ? "Processing..." : (
                <>
                  <TrendingUp className="w-5 h-5" />
                  Secure Checkout
                </>
              )}
            </button>
            
            <button
              onClick={handleReset}
              disabled={selectedSeats.length === 0}
              className="w-full backdrop-blur-xl bg-white/10 hover:bg-white/20 disabled:bg-white/5 disabled:cursor-not-allowed border border-white/20 py-3 px-4 rounded-xl font-semibold transition-all flex items-center justify-center gap-2"
            >
              <X className="w-4 h-4" />
              Clear Selection
            </button>

             {/* ADMIN KILL SWITCH */}
             <button 
                onClick={handleResetDB}
                className="mt-6 w-full group relative overflow-hidden bg-red-950/30 border border-red-500/30 hover:bg-red-900/50 text-red-400 hover:text-red-200 py-3 px-4 rounded-xl font-mono text-xs uppercase tracking-widest transition-all"
            >
                <div className="flex items-center justify-center gap-2">
                    <Trash2 className="w-3 h-3 group-hover:animate-bounce" />
                    <span>Admin: Wipe Database</span>
                </div>
            </button>

          </div>
        </div>
      </div>

      <div className="max-w-[1800px] mx-auto mt-6">
        <div className="backdrop-blur-xl bg-black/80 border-2 border-green-500/50 rounded-2xl overflow-hidden shadow-2xl shadow-green-500/20">
          <div className="bg-gray-900 px-4 py-2 border-b border-green-500/30 flex justify-between">
            <span className="text-green-500 font-mono text-sm">⚡ SYSTEM LOGS</span>
          </div>
          <div className="p-4 h-48 overflow-y-auto font-mono text-xs space-y-1">
             {logs.map(log => (
                 <div key={log.id} className={log.type === 'error' ? 'text-red-400' : 'text-green-400'}>
                     <span className="text-gray-500">[{log.timestamp}]</span> {log.message}
                 </div>
             ))}
          </div>
        </div>
      </div>
    </div>
  );
}