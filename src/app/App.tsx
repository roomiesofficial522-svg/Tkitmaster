import { useState, useEffect, useCallback } from 'react';
import { Clock, AlertCircle, Check, X, Zap, TrendingUp } from 'lucide-react';
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
}

interface LogEntry {
  id: number;
  timestamp: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
}

const ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
const SEATS_PER_ROW = 10;
const BOOKING_TIME_LIMIT = 300; // 5 minutes in seconds

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

  // 🆔 USER ID GENERATOR
  // We generate a random ID for "Me" so the server can distinguish between User A and User B
  const [myUserId] = useState(() => Math.floor(Math.random() * 10000) + 1);

  // Initialize seats
  useEffect(() => {
    const initialSeats: Seat[] = [];
    ROWS.forEach((row) => {
      const tier = getTierForRow(row);
      const tierPrice = TIER_CONFIG[tier].price;
      
      for (let num = 1; num <= SEATS_PER_ROW; num++) {
        const seatId = `${row}${num}`;
        // Clean board for testing (Everyone starts available)
        initialSeats.push({
          id: seatId,
          row,
          number: num,
          state: 'available',
          tier,
          price: tierPrice,
        });
      }
    });
    setSeats(initialSeats);
    
    // Initial logs
    addLog(`System initialized. You are User_${myUserId}`, 'success');
    addLog('Redis Engine connection established', 'info');
  }, [myUserId]);

  // Add log entry
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
        return [newLog, ...prevLogs].slice(0, 100); // Keep last 100 logs
      });
      return newId;
    });
  }, []);

  // Countdown timer
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          toast.error('Session expired! Refreshing...');
          setTimeout(() => window.location.reload(), 2000);
          return 0;
        }
        if (prev === 60) {
          toast.error('⚠️ Only 1 minute remaining!', { duration: 5000 });
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Simulate concurrent users (Visual Noise Only)
  // Replace the initialization useEffect with this:
  useEffect(() => {
    const fetchStadium = async () => {
      try {
        const res = await fetch('http://localhost:3001/api/seats');
        const data = await res.json();
        
        if (data.seats) {
          // Map backend data to frontend interface
          // Note: Backend says 'locked', 'booked', 'available'. 
          // Frontend expects specific logic.
          setSeats(data.seats);
          addLog('Connected to Live Stadium Database', 'success');
        }
      } catch (err) {
        toast.error("Could not load stadium data");
        addLog('Failed to connect to backend', 'error');
      }
    };

    fetchStadium();
    
    // Optional: Poll every 2 seconds to see other people's updates (Live View)
    const interval = setInterval(fetchStadium, 2000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // ==============================================
  // ⚡ CORE LOGIC: HANDLE SEAT CLICK (ATOMIC LOCK)
  // ==============================================
  const handleSeatClick = async (seatId: string) => {
    const seat = seats.find((s) => s.id === seatId);

    // 1. Basic Checks
    if (!seat || seat.state === 'booked') {
        toast.error("Seat unavailable");
        return;
    }

    // 2. CHECK: Is it locked by SOMEONE ELSE?
    // If it's locked, but NOT by me, I can't touch it.
    if (seat.state === 'locked' && seat.lockedBy !== myUserId) {
        toast.error(`Seat ${seatId} is currently held by another user.`);
        return;
    }

    // 3. DESELECT / RELEASE LOGIC
    // If I already have it selected (or I hold the lock), clicking again releases it.
    if (selectedSeats.includes(seatId)) {
        // Optimistic UI Update
        setSelectedSeats((prev) => prev.filter((id) => id !== seatId));
        setSeats((prev) => prev.map((s) => (s.id === seatId ? { ...s, state: 'available', lockedBy: undefined } : s)));
        
        // Call Backend to Release Lock
        await fetch('http://localhost:3001/api/release', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ seatId, userId: myUserId })
        });
        addLog(`Lock released for ${seatId}`, 'info');
        return;
    }

    // 4. SELECT / LOCK LOGIC (Same as before)
    try {
        const response = await fetch('http://localhost:3001/api/lock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ seatId, userId: myUserId })
        });
        const data = await response.json();

        if (response.ok && data.success) {
            setSelectedSeats((prev) => [...prev, seatId]);
            // MARK IT AS LOCKED BY *ME*
            setSeats((prev) => prev.map((s) => (s.id === seatId ? { ...s, state: 'locked', lockedBy: myUserId } : s))); 
            toast.success(`Seat Locked! 5:00 timer started.`);
        } else {
            setSeats((prev) => prev.map((s) => (s.id === seatId ? { ...s, state: 'locked' } : s))); // Lock it visually
            toast.error("Too Slow! Seat just taken.");
        }
    } catch (error) {
        toast.error("Network Error");
    }
  };

  const handleReset = async () => {
    // Release ALL locks held by me
    await Promise.all(selectedSeats.map(seatId => 
        fetch('http://localhost:3001/api/release', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ seatId, userId: myUserId })
        })
    ));

    setSeats((prev) => prev.map((s) => selectedSeats.includes(s.id) ? { ...s, state: 'available', lockedBy: undefined } : s));
    setSelectedSeats([]);
    addLog('Selection cleared & locks released', 'info');
    toast.info('All selections cleared');
  };

  // ==============================================
  // ⚡ CORE LOGIC: PAYMENT (IDEMPOTENCY)
  // ==============================================
  const handleBookNow = async () => {
    if (selectedSeats.length === 0) {
      toast.error('No seats selected!');
      return;
    }

    setIsBooking(true);
    addLog(`Initiating secure checkout...`, 'info');

    // GENERATE IDEMPOTENCY KEY
    // This key is unique to THIS set of seats for THIS user.
    // If you click the button 5 times, the key stays the same, so the server knows.
    const idempotencyKey = `cart_${myUserId}_${selectedSeats.join('_')}`;

    try {
      const response = await fetch('http://localhost:3001/api/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey,
          seatId: selectedSeats[0], // Simplified for single seat demo
          userId: myUserId
        })
      });

      const data = await response.json();

      if (data.success) {
        // ✅ PAYMENT SUCCESS
        const totalAmount = selectedSeats.reduce((sum, seatId) => {
          const seat = seats.find((s) => s.id === seatId);
          return sum + (seat?.price || 0);
        }, 0);
        
        setSeats((prev) => prev.map((s) => selectedSeats.includes(s.id) ? { ...s, state: 'booked' } : s));
        
        addLog(`✓ PAYMENT CONFIRMED: Tx ID ${data.txId}`, 'success');
        addLog(`Idempotency Token: ${idempotencyKey}`, 'info');
        toast.success(`🎉 Booking Confirmed! Seat secured.`);
        setSelectedSeats([]);
      } else {
        // ❌ PAYMENT FAILED
        toast.error(data.message || "Payment Failed");
        addLog(`> PAYMENT ERROR: ${data.message}`, 'error');
      }
    } catch (error) {
      toast.error("Network Error");
    } finally {
      setIsBooking(false);
    }
  };

  const calculateTotal = () => {
    return selectedSeats.reduce((sum, seatId) => {
      const seat = seats.find((s) => s.id === seatId);
      return sum + (seat?.price || 0);
    }, 0);
  };

  const getSelectedSeatsByTier = () => {
    const breakdown: Record<SeatTier, string[]> = { vip: [], premium: [], standard: [] };
    selectedSeats.forEach((seatId) => {
      const seat = seats.find((s) => s.id === seatId);
      if (seat) {
        breakdown[seat.tier].push(seatId);
      }
    });
    return breakdown;
  };

  const totalPrice = calculateTotal();
  const seatBreakdown = getSelectedSeatsByTier();

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-6 overflow-hidden">
      <Toaster position="top-center" theme="dark" richColors />
      
      {/* HUD Top Bar */}
      <div className="max-w-[1800px] mx-auto mb-6">
        <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-4 md:p-6 shadow-2xl">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            {/* Event Title */}
            <div>
              <h1 className="text-3xl md:text-5xl font-black tracking-tight bg-gradient-to-r from-white via-blue-200 to-purple-300 bg-clip-text text-transparent mb-2">
                COLDPLAY: LIVE IN MUMBAI
              </h1>
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Zap className="w-4 h-4 text-yellow-500" />
                <span>DY Patil Stadium • March 15, 2026</span>
              </div>
            </div>
            
            {/* Live Stats */}
            <div className="flex items-center gap-3 md:gap-4">
              {/* Live Users */}
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
              
              {/* Session Timer */}
              <div className="backdrop-blur-xl bg-white/5 border border-yellow-500/30 rounded-xl px-4 py-3 flex items-center gap-3 shadow-lg shadow-yellow-500/20">
                <Clock className="w-6 h-6 text-yellow-500" />
                <div>
                  <div className="text-xs text-gray-400 uppercase tracking-wider">Session Time</div>
                  <div className={`text-xl md:text-2xl font-bold font-mono ${timeLeft < 60 ? 'text-red-500 animate-pulse' : 'text-yellow-500'}`}>
                    {formatTime(timeLeft)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="max-w-[1800px] mx-auto grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Seat Map - Center Hero */}
        <div className="xl:col-span-2">
          <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-4 md:p-8 shadow-2xl">
            {/* Stage */}
            <div className="mb-8">
              <div className="relative bg-gradient-to-b from-purple-600/30 to-pink-600/30 border border-purple-500/50 rounded-xl py-4 text-center overflow-hidden shadow-lg shadow-purple-500/30">
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-pulse"></div>
                <span className="relative text-2xl font-bold tracking-widest bg-gradient-to-r from-purple-300 to-pink-300 bg-clip-text text-transparent">
                  ⚡ STAGE ⚡
                </span>
              </div>
            </div>
            
            {/* Seat Grid */}
            <div className="relative mb-6">
              {/* Row labels */}
              <div className="absolute -left-6 md:-left-10 top-0 flex flex-col gap-1">
                {ROWS.map((row) => {
                  const tier = getTierForRow(row);
                  const tierColor = tier === 'vip' ? 'text-yellow-500' : tier === 'premium' ? 'text-purple-500' : 'text-blue-500';
                  return (
                    <div key={row} className={`h-7 md:h-9 flex items-center justify-center text-sm font-bold font-mono ${tierColor}`}>
                      {row}
                    </div>
                  );
                })}
              </div>
              
              {/* Seats */}
              <div className="grid grid-cols-10 gap-1">
                {seats.map((seat) => {
                const tierConfig = TIER_CONFIG[seat.tier];
                
                // 1. DETERMINE OWNERSHIP
                // "My Lock" means the server says it's locked AND the ID matches mine.
                const isMyLock = seat.lockedBy === myUserId;
                
                // "Locked by Other" means it is locked, but NOT by me.
                const isLockedByOther = seat.state === 'locked' && !isMyLock;

                // 2. DEFINE STATES
                const isAvailable = seat.state === 'available';
                const isBooked = seat.state === 'booked';
                
                // "Selected" visually now encompasses "I clicked it" OR "I hold the lock"
                // This ensures it stays Blue even after the server confirms the lock
                const isSelected = selectedSeats.includes(seat.id) || isMyLock;

                return (
                  <button
                    key={seat.id}
                    onClick={() => handleSeatClick(seat.id)}
                    // CRITICAL: Disable ONLY if someone ELSE has it. 
                    // If YOU have it, it is NOT disabled (so you can click to release/deselect).
                    disabled={isBooked || isLockedByOther} 
                    className={`
                      h-7 md:h-9 rounded-md transition-all duration-200 text-xs font-mono relative
                      
                      ${/* AVAILABLE STATE */ ''}
                      ${isAvailable ? `bg-white/5 border-2 ${tierConfig.color} hover:bg-gradient-to-br hover:shadow-lg ${tierConfig.glowColor} hover:scale-110` : ''}
                      
                      ${/* MY LOCK / SELECTED STATE (Blue/Cyan) - Shows for YOU */ ''}
                      ${isSelected ? 'bg-gradient-to-br from-cyan-500 to-blue-600 border-2 border-cyan-400 scale-105 shadow-lg shadow-cyan-500/50 z-10' : ''}
                      
                      ${/* SOLD STATE (Gray/Cross) */ ''}
                      ${isBooked ? 'bg-gray-800/50 border border-gray-700 opacity-30 cursor-not-allowed line-through' : ''}
                      
                      ${/* LOCKED BY OTHERS STATE (Orange/Pulse) - Shows for EVERYONE ELSE */ ''}
                      ${isLockedByOther ? 'bg-gradient-to-br from-orange-500 to-red-500 animate-pulse border-2 border-orange-400 cursor-not-allowed shadow-lg shadow-orange-500/50' : ''}
                    `}
                    title={
                      isLockedByOther
                        ? `🔒 Locked by User_${seat.lockedBy}`
                        : isBooked
                        ? '❌ Sold'
                        : isSelected
                        ? '✅ Reserved by You (Click to Release)'
                        : `${seat.id} - ₹${seat.price.toLocaleString()}`
                    }
                  >
                    {isSelected && <Check className="w-3 h-3 md:w-4 md:h-4 mx-auto text-white" />}
                    {isBooked && <X className="w-3 h-3 mx-auto text-gray-600" />}
                    {isLockedByOther && <div className="w-2 h-2 md:w-3 md:h-3 mx-auto bg-white rounded-full"></div>}
                  </button>
                );
              })}
              </div>
            </div>
            
            {/* Legend */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs md:text-sm border-t border-white/10 pt-4">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-white/5 border-2 border-yellow-500 rounded-md shadow-sm shadow-yellow-500/50"></div>
                <span className="text-yellow-500 font-semibold">VIP ₹12K</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-white/5 border-2 border-purple-500 rounded-md shadow-sm shadow-purple-500/50"></div>
                <span className="text-purple-500 font-semibold">Premium ₹8K</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-white/5 border-2 border-blue-500 rounded-md shadow-sm shadow-blue-500/50"></div>
                <span className="text-blue-500 font-semibold">Standard ₹5K</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-gradient-to-br from-orange-500 to-red-500 animate-pulse rounded-md shadow-sm shadow-orange-500/50"></div>
                <span className="text-orange-500 font-semibold">Locked</span>
              </div>
            </div>
          </div>
        </div>

        {/* Booking Sidebar */}
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
              {isBooking ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  Processing...
                </>
              ) : (
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
          </div>
        </div>
      </div>

      {/* The Matrix Console - Star of the Show */}
      <div className="max-w-[1800px] mx-auto mt-6">
        <div className="backdrop-blur-xl bg-black/80 border-2 border-green-500/50 rounded-2xl overflow-hidden shadow-2xl shadow-green-500/20">
          {/* Console Header */}
          <div className="bg-gradient-to-r from-gray-900 via-green-950 to-gray-900 px-4 md:px-6 py-3 border-b-2 border-green-500/50 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500 shadow-lg shadow-red-500/50"></div>
                <div className="w-3 h-3 rounded-full bg-yellow-500 shadow-lg shadow-yellow-500/50"></div>
                <div className="w-3 h-3 rounded-full bg-green-500 shadow-lg shadow-green-500/50 animate-pulse"></div>
              </div>
              <span className="text-green-400 font-mono text-sm md:text-base font-bold tracking-wider">
                ⚡ LIVE TRANSACTION MONITOR
              </span>
            </div>
            <div className="text-green-500 font-mono text-xs md:text-sm animate-pulse">
              ● SYNCED
            </div>
          </div>
          
          {/* Console Body */}
          <div className="p-4 md:p-6 h-64 md:h-80 overflow-y-auto font-mono text-xs md:text-sm scrollbar-thin scrollbar-thumb-green-500 scrollbar-track-gray-900">
            {logs.length === 0 ? (
              <div className="text-green-500 animate-pulse">
                <span className="text-gray-600">[SYSTEM]</span> Initializing real-time feed...
              </div>
            ) : (
              <div className="space-y-1">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className={`${
                      log.type === 'error'
                        ? 'text-red-400'
                        : log.type === 'warning'
                        ? 'text-yellow-400'
                        : log.type === 'success'
                        ? 'text-green-400'
                        : 'text-green-500'
                    } hover:bg-white/5 px-2 py-1 rounded transition-colors`}
                  >
                    <span className="text-gray-600">[{log.timestamp}]</span>{' '}
                    <span className="opacity-90">{log.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}