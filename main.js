// ===== SUPABASE CONFIG =====
const SUPABASE_URL = 'https://appchpluexdgaonhpmbe.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwcGNocGx1ZXhkZ2FvbmhwbWJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzMDc0MzQsImV4cCI6MjA4NDg4MzQzNH0.KzzliMOY4JP-6cVM84m_yG1iJWv_ymPbucgMR6aBfZY';

// ============================================
// ============ REAL-TIME DATA STORE ==========
// ============================================

class DataStore {
    constructor() {
        this.currentUser = null;
        this.currentPage = 'landing';
        this.supabaseClient = null;
        this.isSupabaseLoaded = false;
        
        // Real-time subscriptions
        this.chatSubscriptions = new Map();
        this.paymentSubscription = null;
        this.notificationSubscription = null;
        this.bookingSubscription = null;
        this.requestSubscription = null;
        
        // Unread notifications
        this.unreadNotifications = new Set();
        this.unreadPayments = new Set();
        this.unreadChats = new Set();
        this.unreadRequests = new Set();
    }

    async initSupabase() {
        try {
            this.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
                auth: { 
                    autoRefreshToken: true, 
                    persistSession: true,
                    detectSessionInUrl: true 
                },
                realtime: { 
                    params: { 
                        eventsPerSecond: 20
                    } 
                }
            });
            this.isSupabaseLoaded = true;
            console.log('✅ Supabase initialized');
            
            await this.subscribeToRealtime();
            return true;
        } catch (error) {
            console.error('❌ Supabase init failed:', error);
            return false;
        }
    }

    // ===== REAL-TIME SUBSCRIPTIONS =====
    async subscribeToRealtime() {
        if (!this.supabaseClient) return;

        // 1. PAYMENTS CHANNEL
        this.paymentSubscription = this.supabaseClient
            .channel('payments-realtime')
            .on('postgres_changes', { 
                event: 'INSERT', 
                schema: 'public', 
                table: 'payments' 
            }, async (payload) => {
                const payment = payload.new;
                
                if (payment.seeker_id === this.currentUser?.id) {
                    this.unreadPayments.add(payment.id);
                    this.unreadNotifications.add(payment.id);
                    
                    const provider = await this.getUserById(payment.provider_id);
                    
                    window.showAlert('info', `💰 Payment request of PKR ${payment.amount} from ${provider?.name || 'Provider'}`);
                    
                    window.updateNotificationBadges();
                    
                    if (this.currentPage === 'notifications') {
                        window.loadNotifications();
                    }
                }
                
                if (payment.provider_id === this.currentUser?.id) {
                    window.showAlert('success', `✅ Payment request of PKR ${payment.amount} sent instantly!`);
                }
            })
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'payments'
            }, async (payload) => {
                const payment = payload.new;
                
                if (payment.provider_id === this.currentUser?.id && payment.status === 'COMPLETED') {
                    window.showAlert('success', `💰 Payment of PKR ${payment.amount} completed by customer!`);
                    
                    if (this.currentPage === 'provider-dashboard') {
                        window.loadProviderDashboard();
                    }
                    if (this.currentPage === 'provider-payment-requests') {
                        window.loadProviderPaymentRequests();
                    }
                }
                
                if (payment.seeker_id === this.currentUser?.id && payment.status === 'COMPLETED') {
                    window.showAlert('success', `✅ Payment confirmed! Thank you for your payment.`);
                    
                    if (this.currentPage === 'seeker-dashboard') {
                        window.loadSeekerDashboard();
                    }
                    if (this.currentPage === 'notifications') {
                        window.loadNotifications();
                    }
                    
                    setTimeout(() => {
                        window.showRatingModal(payment.booking_id, payment.provider_id, 'PROVIDER', 'SEEKER');
                    }, 1000);
                }
            })
            .subscribe();

        // 2. SERVICE REQUESTS CHANNEL
        this.requestSubscription = this.supabaseClient
            .channel('requests-realtime')
            .on('postgres_changes', { 
                event: 'INSERT', 
                schema: 'public', 
                table: 'service_requests' 
            }, async (payload) => {
                const request = payload.new;
                
                // Notify nearby providers
                if (this.currentUser?.role === 'PROVIDER' && this.currentUser.lat && this.currentUser.lng) {
                    const distance = this.calculateDistance(
                        this.currentUser.lat, this.currentUser.lng,
                        request.lat, request.lng
                    );
                    
                    if (distance <= 10) { // Within 10km
                        this.unreadRequests.add(request.id);
                        this.unreadNotifications.add(request.id);
                        
                        window.showAlert('info', `📍 New service request in your area for ${request.category}`);
                        
                        if (this.currentPage === 'provider-dashboard') {
                            window.loadNearbyRequests();
                        }
                    }
                }
                
                // Notify seeker that request is posted
                if (request.seeker_id === this.currentUser?.id) {
                    window.showAlert('success', '✅ Your request has been posted!');
                    
                    if (this.currentPage === 'seeker-marketplace') {
                        window.loadSeekerActiveRequests();
                    }
                }
            })
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'request_offers'
            }, async (payload) => {
                const offer = payload.new;
                
                // Notify seeker of new offer
                if (offer.seeker_id === this.currentUser?.id) {
                    this.unreadNotifications.add(offer.id);
                    window.updateNotificationBadges();
                    
                    window.showAlert('info', `💰 New offer received for your request`);
                    
                    if (this.currentPage === 'seeker-marketplace') {
                        window.loadSeekerActiveRequests();
                    }
                }
                
                // Notify provider that offer is sent
                if (offer.provider_id === this.currentUser?.id) {
                    window.showAlert('success', '✅ Your offer has been sent!');
                }
            })
            .subscribe();

        // 3. BOOKINGS CHANNEL
        this.bookingSubscription = this.supabaseClient
            .channel('bookings-realtime')
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'bookings'
            }, async (payload) => {
                const booking = payload.new;
                
                if (booking.status === 'CANCELLED') {
                    if (booking.seeker_id === this.currentUser?.id || booking.provider_id === this.currentUser?.id) {
                        window.showAlert('info', `📝 Order cancelled: ${booking.cancellation_reason || 'No reason provided'}`);
                        
                        if (this.currentPage === 'seeker-dashboard' && this.currentUser?.id === booking.seeker_id) {
                            window.loadSeekerDashboard();
                        }
                        if (this.currentPage === 'provider-dashboard' && this.currentUser?.id === booking.provider_id) {
                            window.loadProviderDashboard();
                        }
                    }
                }
                
                if (booking.status === 'COMPLETED') {
                    if (booking.seeker_id === this.currentUser?.id) {
                        setTimeout(() => {
                            window.showRatingModal(booking.id, booking.provider_id, 'PROVIDER', 'SEEKER');
                        }, 1000);
                    }
                    if (booking.provider_id === this.currentUser?.id) {
                        setTimeout(() => {
                            window.showRatingModal(booking.id, booking.seeker_id, 'SEEKER', 'PROVIDER');
                        }, 1000);
                    }
                }
            })
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'bookings'
            }, async (payload) => {
                const booking = payload.new;
                
                if (booking.provider_id === this.currentUser?.id) {
                    window.showAlert('info', `📅 New booking confirmed`);
                    if (this.currentPage === 'provider-dashboard') {
                        window.loadProviderDashboard();
                    }
                }
            })
            .subscribe();

        // 4. CHAT MESSAGES
        this.supabaseClient
            .channel('chat-realtime')
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'chat_messages'
            }, (payload) => {
                const msg = payload.new;
                if (msg.sender_id !== this.currentUser?.id) {
                    this.unreadChats.add(msg.conversation_id);
                    window.updateNotificationBadges();
                    window.showAlert('info', `💬 New message from ${msg.sender_name}`);
                }
                
                if (window.chatState?.activeConversationId === msg.conversation_id) {
                    window.appendMessage(msg);
                }
            })
            .subscribe();
    }

    // ===== LOCATION UTILITIES =====
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth's radius in km
        const dLat = this.deg2rad(lat2 - lat1);
        const dLon = this.deg2rad(lon2 - lon1);
        const a = 
            Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) * 
            Math.sin(dLon/2) * Math.sin(dLon/2); 
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
        return R * c;
    }

    deg2rad(deg) {
        return deg * (Math.PI/180);
    }

    // ===== SERVICE REQUESTS =====
    async createServiceRequest(requestData) {
        try {
            if (!this.currentUser || this.currentUser.role !== 'SEEKER') {
                throw new Error('Only seekers can post requests');
            }

            const request = {
                seeker_id: this.currentUser.id,
                seeker_name: this.currentUser.name,
                category: requestData.category,
                description: requestData.description,
                price: parseFloat(requestData.price),
                lat: parseFloat(requestData.lat),
                lng: parseFloat(requestData.lng),
                address: requestData.address || 'Location set',
                status: 'OPEN',
                created_at: new Date().toISOString(),
                expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
            };

            const { data, error } = await this.supabaseClient
                .from('service_requests')
                .insert([request])
                .select()
                .single();

            if (error) throw error;

            return { success: true, request: data, message: 'Request posted successfully!' };
        } catch (error) {
            console.error('Create request error:', error);
            return { success: false, error: error.message };
        }
    }

    async getNearbyRequests(providerId) {
        try {
            if (!this.currentUser) return [];

            const provider = await this.getUserById(providerId);
            if (!provider || !provider.lat || !provider.lng) return [];

            const { data: requests, error } = await this.supabaseClient
                .from('service_requests')
                .select('*')
                .eq('status', 'OPEN')
                .gt('expires_at', new Date().toISOString())
                .order('created_at', { ascending: false });

            if (error) throw error;

            // Filter nearby requests
            const nearbyRequests = requests.filter(req => {
                const distance = this.calculateDistance(
                    provider.lat, provider.lng,
                    req.lat, req.lng
                );
                return distance <= 10; // Within 10km
            });

            return nearbyRequests;
        } catch (error) {
            console.error('Get nearby requests error:', error);
            return [];
        }
    }

    async getUserRequests(userId, role) {
        try {
            let query = this.supabaseClient
                .from('service_requests')
                .select('*')
                .order('created_at', { ascending: false });

            if (role === 'SEEKER') {
                query = query.eq('seeker_id', userId);
            }

            const { data, error } = await query;
            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Get user requests error:', error);
            return [];
        }
    }

    async createOffer(offerData) {
        try {
            if (!this.currentUser || this.currentUser.role !== 'PROVIDER') {
                throw new Error('Only providers can make offers');
            }

            // Check if already offered
            const { data: existing } = await this.supabaseClient
                .from('request_offers')
                .select('id')
                .eq('request_id', offerData.request_id)
                .eq('provider_id', this.currentUser.id)
                .maybeSingle();

            if (existing) {
                throw new Error('You have already made an offer for this request');
            }

            const offer = {
                request_id: offerData.request_id,
                provider_id: this.currentUser.id,
                provider_name: this.currentUser.name,
                seeker_id: offerData.seeker_id,
                price: parseFloat(offerData.price),
                message: offerData.message || '',
                status: 'PENDING',
                created_at: new Date().toISOString()
            };

            const { data, error } = await this.supabaseClient
                .from('request_offers')
                .insert([offer])
                .select()
                .single();

            if (error) throw error;

            // Create notification for seeker
            const notification = {
                user_id: offerData.seeker_id,
                title: '💰 New Offer Received',
                message: `${this.currentUser.name} offered PKR ${offerData.price} for your request`,
                type: 'NEW_OFFER',
                data: {
                    request_id: offerData.request_id,
                    offer_id: data.id,
                    provider_id: this.currentUser.id,
                    provider_name: this.currentUser.name,
                    price: offerData.price
                },
                is_read: false,
                created_at: new Date().toISOString()
            };

            await this.supabaseClient
                .from('notifications')
                .insert([notification]);

            return { success: true, offer: data, message: 'Offer sent successfully!' };
        } catch (error) {
            console.error('Create offer error:', error);
            return { success: false, error: error.message };
        }
    }

    async getOffersForRequest(requestId) {
        try {
            const { data, error } = await this.supabaseClient
                .from('request_offers')
                .select('*, provider:provider_id(name, rating)')
                .eq('request_id', requestId)
                .order('price', { ascending: true });

            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Get offers error:', error);
            return [];
        }
    }

    async acceptOffer(offerId, requestId) {
        try {
            if (!this.currentUser || this.currentUser.role !== 'SEEKER') {
                throw new Error('Only seekers can accept offers');
            }

            // Get offer details
            const { data: offer, error: offerError } = await this.supabaseClient
                .from('request_offers')
                .select('*')
                .eq('id', offerId)
                .single();

            if (offerError || !offer) throw new Error('Offer not found');

            // Create booking from offer
            const booking = {
                service_id: null,
                seeker_id: this.currentUser.id,
                provider_id: offer.provider_id,
                price: offer.price,
                scheduled_time: new Date().toISOString(),
                note: `Request: ${requestId}`,
                status: 'APPROVED',
                created_at: new Date().toISOString()
            };

            const { error: bookingError } = await this.supabaseClient
                .from('bookings')
                .insert([booking]);

            if (bookingError) throw bookingError;

            // Update offer status
            await this.supabaseClient
                .from('request_offers')
                .update({ status: 'ACCEPTED' })
                .eq('id', offerId);

            // Update request status
            await this.supabaseClient
                .from('service_requests')
                .update({ status: 'CLOSED' })
                .eq('id', requestId);

            // Reject other offers
            await this.supabaseClient
                .from('request_offers')
                .update({ status: 'REJECTED' })
                .eq('request_id', requestId)
                .neq('id', offerId);

            // Notify provider
            const notification = {
                user_id: offer.provider_id,
                title: '✅ Offer Accepted',
                message: `${this.currentUser.name} accepted your offer of PKR ${offer.price}`,
                type: 'OFFER_ACCEPTED',
                data: {
                    request_id: requestId,
                    offer_id: offerId,
                    price: offer.price
                },
                is_read: false,
                created_at: new Date().toISOString()
            };

            await this.supabaseClient
                .from('notifications')
                .insert([notification]);

            return { success: true, message: 'Offer accepted! Booking created.' };
        } catch (error) {
            console.error('Accept offer error:', error);
            return { success: false, error: error.message };
        }
    }

    // ===== AUTH METHODS =====
    async login(email, password, expectedRole) {
        try {
            const { data, error } = await this.supabaseClient.auth.signInWithPassword({
                email: email.toLowerCase(),
                password: password
            });

            if (error) throw error;

            const { data: profile, error: profileError } = await this.supabaseClient
                .from('users')
                .select('*')
                .eq('id', data.user.id)
                .single();

            if (profileError) throw profileError;

            if (profile.role !== expectedRole) {
                await this.supabaseClient.auth.signOut();
                throw new Error(`This account is registered as a ${profile.role.toLowerCase()}. Please use the correct login page.`);
            }

            this.currentUser = {
                id: profile.id,
                name: profile.name,
                email: profile.email,
                role: profile.role,
                payment_method: profile.payment_method,
                payment_detail: profile.payment_detail,
                rating: profile.rating || 0,
                lat: profile.lat,
                lng: profile.lng,
                address: profile.address
            };

            return { success: true, user: this.currentUser };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async signup(userData) {
        try {
            const { data: authData, error: authError } = await this.supabaseClient.auth.signUp({
                email: userData.email.toLowerCase(),
                password: userData.password,
                options: {
                    data: {
                        name: userData.name,
                        role: userData.role
                    }
                }
            });

            if (authError) throw authError;

            const userProfile = {
                id: authData.user.id,
                email: userData.email.toLowerCase(),
                name: userData.name,
                role: userData.role.toUpperCase(),
                phone: userData.phone || null,
                service_category: userData.serviceCategory || null,
                payment_method: userData.paymentMethod || null,
                payment_detail: userData.paymentDetail || null,
                lat: userData.lat || null,
                lng: userData.lng || null,
                address: userData.address || null,
                rating: 0,
                status: 'ACTIVE',
                created_at: new Date().toISOString()
            };

            const { error: profileError } = await this.supabaseClient
                .from('users')
                .insert([userProfile]);

            if (profileError) throw profileError;

            return { success: true, user: authData.user };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async updateUserLocation(lat, lng, address) {
        try {
            if (!this.currentUser) throw new Error('Not logged in');

            const { error } = await this.supabaseClient
                .from('users')
                .update({ 
                    lat: lat,
                    lng: lng,
                    address: address,
                    updated_at: new Date().toISOString()
                })
                .eq('id', this.currentUser.id);

            if (error) throw error;

            this.currentUser.lat = lat;
            this.currentUser.lng = lng;
            this.currentUser.address = address;

            return { success: true, message: 'Location updated' };
        } catch (error) {
            console.error('Update location error:', error);
            return { success: false, error: error.message };
        }
    }

    async logout() {
        try {
            await this.supabaseClient.auth.signOut();
            this.currentUser = null;
            this.unreadNotifications.clear();
            this.unreadPayments.clear();
            this.unreadChats.clear();
            this.unreadRequests.clear();
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async getCurrentSession() {
        try {
            const { data: { session } } = await this.supabaseClient.auth.getSession();
            if (session?.user) {
                const { data: profile } = await this.supabaseClient
                    .from('users')
                    .select('*')
                    .eq('id', session.user.id)
                    .single();
                    
                if (profile) {
                    this.currentUser = {
                        id: profile.id,
                        name: profile.name,
                        email: profile.email,
                        role: profile.role,
                        payment_method: profile.payment_method,
                        payment_detail: profile.payment_detail,
                        rating: profile.rating || 0,
                        lat: profile.lat,
                        lng: profile.lng,
                        address: profile.address
                    };
                }
            }
            return { session, user: this.currentUser };
        } catch (error) {
            return { session: null, user: null };
        }
    }

    // ===== RATING METHODS =====
    async submitRating(bookingId, targetId, targetRole, raterRole, rating, comment) {
        try {
            if (!this.currentUser) throw new Error('Not logged in');

            const { data: existing } = await this.supabaseClient
                .from('ratings')
                .select('id')
                .eq('booking_id', bookingId)
                .eq('rater_id', this.currentUser.id)
                .maybeSingle();

            if (existing) {
                throw new Error('You have already rated this experience');
            }

            const ratingData = {
                booking_id: bookingId,
                rater_id: this.currentUser.id,
                rater_name: this.currentUser.name,
                rater_role: raterRole,
                target_id: targetId,
                target_role: targetRole,
                rating: parseInt(rating),
                comment: comment || '',
                created_at: new Date().toISOString()
            };

            const { error } = await this.supabaseClient
                .from('ratings')
                .insert([ratingData]);

            if (error) throw error;

            await this.updateUserRating(targetId);

            const notification = {
                user_id: targetId,
                title: '⭐ New Rating Received',
                message: `${this.currentUser.name} rated you ${rating} stars`,
                type: 'RATING_RECEIVED',
                data: {
                    booking_id: bookingId,
                    rater_id: this.currentUser.id,
                    rater_name: this.currentUser.name,
                    rating: rating,
                    comment: comment
                },
                is_read: false,
                created_at: new Date().toISOString()
            };

            await this.supabaseClient
                .from('notifications')
                .insert([notification]);

            return { success: true, message: 'Rating submitted successfully' };
        } catch (error) {
            console.error('Submit rating error:', error);
            return { success: false, error: error.message };
        }
    }

    async updateUserRating(userId) {
        try {
            const { data: ratings } = await this.supabaseClient
                .from('ratings')
                .select('rating')
                .eq('target_id', userId);

            if (!ratings || ratings.length === 0) return;

            const average = ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length;
            const roundedAverage = Math.round(average * 10) / 10;

            await this.supabaseClient
                .from('users')
                .update({ rating: roundedAverage })
                .eq('id', userId);

            if (this.currentUser && this.currentUser.id === userId) {
                this.currentUser.rating = roundedAverage;
            }
        } catch (error) {
            console.error('Update user rating error:', error);
        }
    }

    async getUserRatings(userId) {
        try {
            const { data, error } = await this.supabaseClient
                .from('ratings')
                .select('*, rater:rater_id(name)')
                .eq('target_id', userId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Get user ratings error:', error);
            return [];
        }
    }

    async getUserRatingStats(userId) {
        try {
            const { data: ratings } = await this.supabaseClient
                .from('ratings')
                .select('rating')
                .eq('target_id', userId);

            if (!ratings || ratings.length === 0) {
                return {
                    average: 0,
                    total: 0,
                    distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
                };
            }

            const total = ratings.length;
            const sum = ratings.reduce((acc, curr) => acc + curr.rating, 0);
            const average = Math.round((sum / total) * 10) / 10;

            const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
            ratings.forEach(r => {
                distribution[r.rating] = (distribution[r.rating] || 0) + 1;
            });

            return { average, total, distribution };
        } catch (error) {
            console.error('Get rating stats error:', error);
            return { average: 0, total: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
        }
    }

    // ===== CANCEL BOOKING =====
    async cancelBooking(bookingId, reason, details) {
        try {
            if (!this.currentUser) throw new Error('Not logged in');

            const cancellationText = reason + (details ? `: ${details}` : '');
            
            const { error } = await this.supabaseClient
                .from('bookings')
                .update({ 
                    status: 'CANCELLED',
                    cancellation_reason: cancellationText,
                    updated_at: new Date().toISOString()
                })
                .eq('id', bookingId);

            if (error) throw error;

            const { data: booking } = await this.supabaseClient
                .from('bookings')
                .select('*, seeker:seeker_id(*), provider:provider_id(*), service:services(*)')
                .eq('id', bookingId)
                .single();

            const otherUserId = booking.seeker_id === this.currentUser.id ? booking.provider_id : booking.seeker_id;
            
            const notification = {
                user_id: otherUserId,
                title: '📝 Order Cancelled',
                message: `${this.currentUser.name} cancelled the order: ${cancellationText}`,
                type: 'ORDER_CANCELLED',
                data: {
                    booking_id: bookingId,
                    cancelled_by: this.currentUser.id,
                    cancelled_by_name: this.currentUser.name,
                    reason: cancellationText,
                    service_title: booking.service?.title
                },
                is_read: false,
                created_at: new Date().toISOString()
            };

            await this.supabaseClient
                .from('notifications')
                .insert([notification]);

            return { success: true, message: 'Order cancelled successfully' };
        } catch (error) {
            console.error('Cancel booking error:', error);
            return { success: false, error: error.message };
        }
    }

    // ===== CREATE PAYMENT =====
    async createPayment(paymentData) {
        try {
            if (!this.currentUser || this.currentUser.role !== 'PROVIDER') {
                throw new Error('Only providers can request payments');
            }

            const { data: booking, error: bookingError } = await this.supabaseClient
                .from('bookings')
                .select('*, seeker:seeker_id(*), service:services(*)')
                .eq('id', paymentData.booking_id)
                .single();

            if (bookingError || !booking) throw new Error('Booking not found');

            const { data: existingPayments } = await this.supabaseClient
                .from('payments')
                .select('id, status')
                .eq('booking_id', paymentData.booking_id);

            if (existingPayments && existingPayments.length > 0) {
                const pendingPayment = existingPayments.find(p => p.status === 'PENDING');
                if (pendingPayment) {
                    throw new Error('A payment request already exists for this booking');
                }
            }

            const payment = {
                booking_id: paymentData.booking_id,
                provider_id: this.currentUser.id,
                seeker_id: booking.seeker_id,
                service_id: booking.service_id,
                amount: parseFloat(paymentData.amount),
                method: paymentData.method,
                transaction_id: paymentData.transaction_id,
                status: 'PENDING',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };

            const { data, error } = await this.supabaseClient
                .from('payments')
                .insert([payment])
                .select(`*, booking:bookings(*, service:services(*)), provider:provider_id(*), seeker:seeker_id(*)`)
                .single();

            if (error) throw error;

            const notification = {
                user_id: booking.seeker_id,
                title: '💰 New Payment Request',
                message: `${this.currentUser.name} requested PKR ${paymentData.amount} for ${booking.service?.title || 'service'}`,
                type: 'PAYMENT_REQUEST',
                data: {
                    payment_id: data.id,
                    booking_id: booking.id,
                    amount: paymentData.amount,
                    provider_id: this.currentUser.id,
                    provider_name: this.currentUser.name,
                    service_title: booking.service?.title
                },
                is_read: false,
                created_at: new Date().toISOString()
            };

            await this.supabaseClient
                .from('notifications')
                .insert([notification]);

            return { success: true, payment: data, message: '💰 Payment request sent instantly!' };
        } catch (error) {
            console.error('Create payment error:', error);
            return { success: false, error: error.message };
        }
    }

    // ===== PROCESS PAYMENT =====
    async processPayment(paymentId, transactionId) {
        try {
            if (!this.currentUser || this.currentUser.role !== 'SEEKER') {
                throw new Error('Only seekers can process payments');
            }

            const { data: payment, error: paymentError } = await this.supabaseClient
                .from('payments')
                .select('*, booking:bookings(*, service:services(*)), provider:provider_id(*), seeker:seeker_id(*)')
                .eq('id', paymentId)
                .single();

            if (paymentError || !payment) throw new Error('Payment not found');
            if (payment.seeker_id !== this.currentUser.id) throw new Error('Not authorized');
            if (payment.status !== 'PENDING') throw new Error('Payment already processed');

            const { error: updateError } = await this.supabaseClient
                .from('payments')
                .update({ 
                    status: 'COMPLETED',
                    transaction_id: transactionId,
                    updated_at: new Date().toISOString()
                })
                .eq('id', paymentId);

            if (updateError) throw updateError;

            await this.supabaseClient
                .from('bookings')
                .update({ status: 'COMPLETED' })
                .eq('id', payment.booking_id);

            const notification = {
                user_id: payment.provider_id,
                title: '✅ Payment Completed',
                message: `${this.currentUser.name} completed payment of PKR ${payment.amount}`,
                type: 'PAYMENT_COMPLETED',
                data: {
                    payment_id: payment.id,
                    booking_id: payment.booking_id,
                    amount: payment.amount,
                    seeker_id: this.currentUser.id,
                    seeker_name: this.currentUser.name
                },
                is_read: false,
                created_at: new Date().toISOString()
            };

            await this.supabaseClient
                .from('notifications')
                .insert([notification]);

            this.unreadPayments.delete(paymentId);
            this.unreadNotifications.delete(paymentId);
            window.updateNotificationBadges();

            return { success: true, message: 'Payment completed successfully!' };
        } catch (error) {
            console.error('Process payment error:', error);
            return { success: false, error: error.message };
        }
    }

    // ===== CANCEL PAYMENT =====
    async cancelPayment(paymentId) {
        try {
            if (!this.currentUser || this.currentUser.role !== 'PROVIDER') {
                throw new Error('Only providers can cancel payment requests');
            }

            const { data: payment, error: paymentError } = await this.supabaseClient
                .from('payments')
                .select('*')
                .eq('id', paymentId)
                .single();

            if (paymentError || !payment) throw new Error('Payment not found');
            if (payment.provider_id !== this.currentUser.id) throw new Error('Not authorized');
            if (payment.status !== 'PENDING') throw new Error('Cannot cancel processed payment');

            const { error: deleteError } = await this.supabaseClient
                .from('payments')
                .delete()
                .eq('id', paymentId);

            if (deleteError) throw deleteError;

            return { success: true, message: 'Payment request cancelled' };
        } catch (error) {
            console.error('Cancel payment error:', error);
            return { success: false, error: error.message };
        }
    }

    // ===== GET USER BY ID =====
    async getUserById(userId) {
        try {
            if (!userId) return null;
            
            const { data, error } = await this.supabaseClient
                .from('users')
                .select('id, name, email, role, payment_method, payment_detail, rating, lat, lng, address')
                .eq('id', userId)
                .maybeSingle();
                
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Get user error:', error);
            return null;
        }
    }

    // ===== GET NOTIFICATIONS =====
    async getNotifications(userId) {
        try {
            const { data, error } = await this.supabaseClient
                .from('notifications')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .limit(50);
                
            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Get notifications error:', error);
            return [];
        }
    }

    // ===== MARK NOTIFICATION READ =====
    async markNotificationRead(notificationId) {
        try {
            const { error } = await this.supabaseClient
                .from('notifications')
                .update({ is_read: true })
                .eq('id', notificationId);
                
            if (error) throw error;
            
            const { data: notif } = await this.supabaseClient
                .from('notifications')
                .select('data')
                .eq('id', notificationId)
                .single();
                
            if (notif?.data?.payment_id) {
                this.unreadPayments.delete(notif.data.payment_id);
            }
            if (notif?.data?.request_id) {
                this.unreadRequests.delete(notif.data.request_id);
            }
            
            this.unreadNotifications.delete(notificationId);
            window.updateNotificationBadges();
            return true;
        } catch (error) {
            console.error('Mark read error:', error);
            return false;
        }
    }

    // ===== MARK ALL READ =====
    async markAllNotificationsRead(userId) {
        try {
            const { error } = await this.supabaseClient
                .from('notifications')
                .update({ is_read: true })
                .eq('user_id', userId)
                .eq('is_read', false);
                
            if (error) throw error;
            this.unreadNotifications.clear();
            this.unreadPayments.clear();
            this.unreadRequests.clear();
            window.updateNotificationBadges();
            return true;
        } catch (error) {
            console.error('Mark all read error:', error);
            return false;
        }
    }

    // ===== SERVICES =====
    async getServices(filters = {}) {
        try {
            let query = this.supabaseClient
                .from('services')
                .select(`*, provider:provider_id (id, name, rating, lat, lng)`)
                .eq('is_active', true);

            if (filters.category) query = query.eq('category', filters.category);
            if (filters.search) {
                query = query.or(`title.ilike.%${filters.search}%,description.ilike.%${filters.search}%`);
            }

            const { data, error } = await query;
            if (error) throw error;

            // If user has location, sort by distance
            if (this.currentUser?.lat && this.currentUser?.lng) {
                data.sort((a, b) => {
                    const distA = this.calculateDistance(
                        this.currentUser.lat, this.currentUser.lng,
                        a.provider?.lat || 0, a.provider?.lng || 0
                    );
                    const distB = this.calculateDistance(
                        this.currentUser.lat, this.currentUser.lng,
                        b.provider?.lat || 0, b.provider?.lng || 0
                    );
                    return distA - distB;
                });
            }

            return data || [];
        } catch (error) {
            return [];
        }
    }

    async createService(serviceData) {
        try {
            const service = {
                provider_id: this.currentUser.id,
                title: serviceData.title,
                category: serviceData.category,
                description: serviceData.description,
                price: parseFloat(serviceData.price),
                is_active: true,
                created_at: new Date().toISOString()
            };

            const { data, error } = await this.supabaseClient
                .from('services')
                .insert([service])
                .select()
                .single();

            if (error) throw error;
            return { success: true, service: data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async getServicesByProvider(providerId) {
        try {
            const { data, error } = await this.supabaseClient
                .from('services')
                .select('*')
                .eq('provider_id', providerId);
                
            if (error) throw error;
            return data || [];
        } catch (error) {
            return [];
        }
    }

    async deleteService(serviceId) {
        try {
            const { error } = await this.supabaseClient
                .from('services')
                .delete()
                .eq('id', serviceId)
                .eq('provider_id', this.currentUser.id);
                
            if (error) throw error;
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async toggleServiceStatus(serviceId, isActive) {
        try {
            const { error } = await this.supabaseClient
                .from('services')
                .update({ is_active: isActive })
                .eq('id', serviceId)
                .eq('provider_id', this.currentUser.id);
                
            if (error) throw error;
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async getServiceById(serviceId) {
        try {
            const { data, error } = await this.supabaseClient
                .from('services')
                .select('*, provider:provider_id(*)')
                .eq('id', serviceId)
                .single();
                
            if (error) throw error;
            return data;
        } catch (error) {
            return null;
        }
    }

    // ===== BOOKINGS =====
    async createBooking(bookingData) {
        try {
            const service = await this.getServiceById(bookingData.service_id);
            
            const booking = {
                service_id: bookingData.service_id,
                seeker_id: this.currentUser.id,
                provider_id: service.provider_id,
                price: service.price,
                scheduled_time: bookingData.scheduled_time,
                note: bookingData.note || '',
                status: 'REQUESTED',
                created_at: new Date().toISOString()
            };

            const { data, error } = await this.supabaseClient
                .from('bookings')
                .insert([booking])
                .select()
                .single();

            if (error) throw error;
            return { success: true, booking: data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async getUserBookings(userId) {
        try {
            const { data, error } = await this.supabaseClient
                .from('bookings')
                .select(`*, service:services(*), provider:provider_id(name, rating), seeker:seeker_id(name, rating)`)
                .or(`seeker_id.eq.${userId},provider_id.eq.${userId}`)
                .order('created_at', { ascending: false });
                
            if (error) throw error;
            return data || [];
        } catch (error) {
            return [];
        }
    }

    async updateBookingStatus(bookingId, status) {
        try {
            const { error } = await this.supabaseClient
                .from('bookings')
                .update({ status })
                .eq('id', bookingId);
                
            if (error) throw error;
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // ===== PAYMENTS =====
    async getPayments(filters = {}) {
        try {
            let query = this.supabaseClient
                .from('payments')
                .select(`*, booking:bookings(*, service:services(*)), provider:provider_id(name, payment_method, payment_detail, rating), seeker:seeker_id(name, rating)`);

            if (filters.provider_id) query = query.eq('provider_id', filters.provider_id);
            if (filters.seeker_id) query = query.eq('seeker_id', filters.seeker_id);

            const { data, error } = await query.order('created_at', { ascending: false });
            if (error) throw error;
            return data || [];
        } catch (error) {
            return [];
        }
    }

    async getProviderPayments(providerId) {
        return this.getPayments({ provider_id: providerId });
    }

    async getSeekerPayments(seekerId) {
        return this.getPayments({ seeker_id: seekerId });
    }

    // ===== CHAT =====
    getConversationId(seekerId, providerId) {
        return `${seekerId}:${providerId}`;
    }

    async listConversationsForCurrentUser() {
        if (!this.currentUser) return [];

        try {
            const { data, error } = await this.supabaseClient
                .from('chat_messages')
                .select('conversation_id, seeker_id, provider_id, sender_id, sender_name, content, created_at')
                .or(`seeker_id.eq.${this.currentUser.id},provider_id.eq.${this.currentUser.id}`)
                .order('created_at', { ascending: false });

            if (error) throw error;

            const latestByConv = new Map();
            for (const m of (data || [])) {
                if (!latestByConv.has(m.conversation_id)) {
                    latestByConv.set(m.conversation_id, m);
                }
            }

            const result = [];
            for (const [convId, lastMsg] of latestByConv.entries()) {
                const isSeeker = this.currentUser.role === 'SEEKER';
                const otherId = isSeeker ? lastMsg.provider_id : lastMsg.seeker_id;
                const other = await this.getUserById(otherId);
                result.push({
                    id: convId,
                    seeker_id: lastMsg.seeker_id,
                    provider_id: lastMsg.provider_id,
                    last_message: lastMsg.content || '',
                    last_message_at: lastMsg.created_at,
                    other: { id: otherId, name: other?.name || 'User', rating: other?.rating || 0 },
                    hasUnread: this.unreadChats.has(convId)
                });
            }

            return result;
        } catch (error) {
            return [];
        }
    }

    async getChatMessages(conversationId) {
        try {
            const { data, error } = await this.supabaseClient
                .from('chat_messages')
                .select('*')
                .eq('conversation_id', conversationId)
                .order('created_at', { ascending: true });
                
            if (error) throw error;
            return data || [];
        } catch (error) {
            return [];
        }
    }

    async sendChatMessage(conversationId, content, seekerId, providerId) {
        try {
            const payload = {
                conversation_id: conversationId,
                seeker_id: seekerId,
                provider_id: providerId,
                sender_id: this.currentUser.id,
                sender_name: this.currentUser.name,
                content: content.trim(),
                created_at: new Date().toISOString()
            };

            const { data, error } = await this.supabaseClient
                .from('chat_messages')
                .insert([payload])
                .select()
                .single();

            if (error) throw error;
            return data;
        } catch (error) {
            throw error;
        }
    }

    subscribeToConversation(conversationId, onMessage) {
        if (!this.supabaseClient) return null;
        
        const channel = this.supabaseClient
            .channel(`chat-${conversationId}`)
            .on('postgres_changes', 
                { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `conversation_id=eq.${conversationId}` },
                (payload) => onMessage(payload.new)
            )
            .subscribe();
            
        return channel;
    }

    // ===== STATS =====
    async getStats() {
        try {
            const { count: totalUsers } = await this.supabaseClient
                .from('users')
                .select('*', { count: 'exact', head: true });
            
            const { count: totalProviders } = await this.supabaseClient
                .from('users')
                .select('*', { count: 'exact', head: true })
                .eq('role', 'PROVIDER');
            
            const { count: totalServices } = await this.supabaseClient
                .from('services')
                .select('*', { count: 'exact', head: true })
                .eq('is_active', true);
            
            const { count: totalReviews } = await this.supabaseClient
                .from('ratings')
                .select('*', { count: 'exact', head: true });

            return {
                totalUsers: totalUsers || 0,
                totalProviders: totalProviders || 0,
                totalServices: totalServices || 0,
                totalReviews: totalReviews || 0
            };
        } catch (error) {
            return { totalUsers: 0, totalProviders: 0, totalServices: 0, totalReviews: 0 };
        }
    }

    async getRecentReviews(limit = 6) {
        try {
            const { data, error } = await this.supabaseClient
                .from('ratings')
                .select(`*, rater:rater_id(name), target:target_id(name)`)
                .order('created_at', { ascending: false })
                .limit(limit);
                
            if (error) throw error;
            return data || [];
        } catch (error) {
            return [];
        }
    }

    // ===== FAVORITES =====
    async toggleFavorite(serviceId) {
        try {
            const isFav = await this.isFavorite(this.currentUser.id, serviceId);
            
            if (isFav) {
                await this.supabaseClient
                    .from('favorites')
                    .delete()
                    .match({ user_id: this.currentUser.id, service_id: serviceId });
                return { success: true, isFav: false };
            } else {
                await this.supabaseClient
                    .from('favorites')
                    .insert([{ user_id: this.currentUser.id, service_id: serviceId }]);
                return { success: true, isFav: true };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async isFavorite(userId, serviceId) {
        try {
            const { data } = await this.supabaseClient
                .from('favorites')
                .select('id')
                .match({ user_id: userId, service_id: serviceId })
                .maybeSingle();
            return !!data;
        } catch (error) {
            return false;
        }
    }

    async getUserFavorites(userId) {
        try {
            const { data, error } = await this.supabaseClient
                .from('favorites')
                .select(`service_id, services:service_id (*, provider:provider_id (name, rating, lat, lng))`)
                .eq('user_id', userId);
            if (error) throw error;
            return data.map(f => f.services) || [];
        } catch (error) {
            return [];
        }
    }
}

// ===== INSTANCE =====
const store = new DataStore();

// ============================================
// ============ UI HELPERS ====================
// ============================================

function showAlert(type, message) {
    let container = document.getElementById('alert-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'alert-container';
        container.className = 'fixed top-24 right-4 z-50 max-w-md space-y-3';
        document.body.appendChild(container);
    }
    const id = `alert_${Date.now()}`;
    const bg = type === 'error' ? 'bg-red-900/50 border-red-800' : 
               type === 'success' ? 'bg-green-900/50 border-green-800' :
               'bg-blue-900/50 border-blue-800';
    const icon = type === 'error' ? 'fa-exclamation-circle' : 
                 type === 'success' ? 'fa-check-circle' :
                 'fa-info-circle';
    const color = type === 'error' ? 'text-red-200' : 
                  type === 'success' ? 'text-green-200' :
                  'text-blue-200';
    
    container.insertAdjacentHTML('afterbegin', `
        <div id="${id}" class="${bg} ${color} border px-6 py-4 rounded-xl shadow-lg backdrop-blur-sm flex items-start gap-3 animate-notification-slide">
            <i class="fas ${icon} mt-1"></i>
            <span class="flex-1">${message}</span>
            <button onclick="document.getElementById('${id}').remove()" class="${color} hover:text-white">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `);
    setTimeout(() => document.getElementById(id)?.remove(), 5000);
}

function showLoading(show) {
    const loader = document.getElementById('loading-overlay');
    if (loader) {
        show ? loader.classList.remove('hidden') : loader.classList.add('hidden');
    }
}

function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) { 
        modal.classList.remove('hidden'); 
        document.body.style.overflow = 'hidden'; 
    }
}

function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) { 
        modal.classList.add('hidden'); 
        document.body.style.overflow = 'auto'; 
    }
}

function showPage(pageName) {
    document.querySelectorAll('.page').forEach(p => { 
        p.classList.add('hidden'); 
        p.classList.remove('active'); 
    });
    const target = document.getElementById(`${pageName}-page`);
    if (target) {
        target.classList.remove('hidden');
        target.classList.add('active');
        store.currentPage = pageName;
        updateNavigation();
        window.scrollTo(0, 0);
        
        if (pageName === 'notifications') loadNotifications();
        if (pageName === 'landing') loadLandingPage();
        if (pageName === 'seeker-dashboard') loadSeekerDashboard();
        if (pageName === 'seeker-marketplace') {
            loadSeekerMarketplace();
            loadSeekerActiveRequests();
        }
        if (pageName === 'provider-dashboard') {
            loadProviderDashboard();
            loadNearbyRequests();
        }
        if (pageName === 'payment-history') loadPaymentHistory();
        if (pageName === 'chat') loadChatPage();
        if (pageName === 'provider-payment-requests') loadProviderPaymentRequests();
    }
}

// ===== LOCATION FUNCTIONS =====
function updateUserLocation() {
    if (!navigator.geolocation) {
        showAlert('error', 'Geolocation not supported');
        return;
    }

    showLoading(true);
    navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            
            // Get address from coordinates
            const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
            const data = await response.json();
            const address = data.display_name || 'Location detected';
            
            const result = await store.updateUserLocation(lat, lng, address);
            
            if (result.success) {
                document.getElementById('user-location-display').textContent = address;
                showAlert('success', 'Location updated successfully!');
                
                if (store.currentPage === 'seeker-marketplace') {
                    loadSeekerMarketplace();
                }
                if (store.currentPage === 'provider-dashboard') {
                    loadNearbyRequests();
                }
            }
        } catch (error) {
            showAlert('error', 'Failed to update location');
        } finally {
            showLoading(false);
        }
    }, (err) => {
        showAlert('error', 'Failed to get location: ' + err.message);
        showLoading(false);
    });
}

function updateRequestLocation() {
    if (!navigator.geolocation) {
        showAlert('error', 'Geolocation not supported');
        return;
    }

    showLoading(true);
    navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
            document.getElementById('request-lat').value = pos.coords.latitude;
            document.getElementById('request-lng').value = pos.coords.longitude;
            
            const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`);
            const data = await response.json();
            const address = data.display_name || 'Location detected';
            
            document.getElementById('request-location-display').textContent = address;
            showAlert('success', 'Location set for request');
        } catch (error) {
            showAlert('error', 'Failed to get location');
        } finally {
            showLoading(false);
        }
    }, (err) => {
        showAlert('error', 'Failed to get location');
        showLoading(false);
    });
}

function getProviderLocation() {
    if (!navigator.geolocation) {
        showAlert('error', 'Geolocation not supported');
        return;
    }

    showLoading(true);
    navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
            document.getElementById('provider-lat').value = pos.coords.latitude;
            document.getElementById('provider-lng').value = pos.coords.longitude;
            
            const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`);
            const data = await response.json();
            const address = data.display_name || 'Location detected';
            
            document.getElementById('provider-address').value = address;
            showAlert('success', 'Location detected successfully');
        } catch (error) {
            showAlert('error', 'Failed to get location');
        } finally {
            showLoading(false);
        }
    }, (err) => {
        showAlert('error', 'Failed to get location');
        showLoading(false);
    });
}

// ===== QUICK REQUEST FUNCTIONS =====
function showQuickRequestModal() {
    if (!store.currentUser) {
        showAlert('error', 'Please login first');
        showPage('seeker-login');
        return;
    }

    document.getElementById('quick-request-form').reset();
    document.getElementById('quick-request-error').classList.add('hidden');
    
    if (store.currentUser.lat && store.currentUser.lng) {
        document.getElementById('request-lat').value = store.currentUser.lat;
        document.getElementById('request-lng').value = store.currentUser.lng;
        document.getElementById('request-location-display').textContent = store.currentUser.address || 'Your saved location';
    }
    
    showModal('quick-request-modal');
}

async function handleQuickRequest(data) {
    if (!store.currentUser.lat || !store.currentUser.lng) {
        showAlert('error', 'Please set your location first');
        return;
    }

    showLoading(true);
    try {
        const result = await store.createServiceRequest({
            category: data.category,
            description: data.description,
            price: data.price,
            lat: store.currentUser.lat,
            lng: store.currentUser.lng,
            address: store.currentUser.address
        });

        if (result.success) {
            showAlert('success', result.message);
            hideModal('quick-request-modal');
            await loadSeekerActiveRequests();
        } else {
            const err = document.getElementById('quick-request-error');
            if (err) {
                err.querySelector('span').textContent = result.error;
                err.classList.remove('hidden');
            }
        }
    } catch (error) {
        showAlert('error', error.message);
    } finally {
        showLoading(false);
    }
}

async function loadSeekerActiveRequests() {
    if (!store.currentUser || store.currentUser.role !== 'SEEKER') return;

    try {
        const requests = await store.getUserRequests(store.currentUser.id, 'SEEKER');
        const openRequests = requests.filter(r => r.status === 'OPEN');
        
        const section = document.getElementById('active-requests-section');
        const container = document.getElementById('seeker-active-requests');
        
        if (openRequests.length === 0) {
            section.classList.add('hidden');
            return;
        }

        section.classList.remove('hidden');
        
        let html = '';
        for (const req of openRequests) {
            const offers = await store.getOffersForRequest(req.id);
            
            html += `
                <div class="bg-[#1e1e1e] rounded-xl p-6 border border-[#2a2a2a]">
                    <div class="flex justify-between items-start mb-4">
                        <div>
                            <span class="px-3 py-1 bg-[#ff9900]/20 text-[#ff9900] rounded-full text-xs">${req.category}</span>
                            <h4 class="text-white font-bold text-lg mt-2">${req.description}</h4>
                            <p class="text-[#a0a0a0] text-sm mt-1">Your price: PKR ${req.price}</p>
                            <p class="text-[#a0a0a0] text-xs mt-1">${req.address}</p>
                        </div>
                        <span class="px-3 py-1 bg-green-900/30 text-green-300 rounded-full text-xs">OPEN</span>
                    </div>
                    
                    <div class="mt-4">
                        <h5 class="text-white font-semibold mb-3">Offers Received (${offers.length})</h5>
                        ${offers.length === 0 ? 
                            '<p class="text-[#a0a0a0] text-sm">No offers yet</p>' : 
                            offers.map(o => `
                                <div class="bg-[#121212] p-4 rounded-xl mb-3 border border-[#2a2a2a]">
                                    <div class="flex justify-between items-center">
                                        <div>
                                            <div class="flex items-center gap-2">
                                                <span class="text-white font-semibold">${o.provider_name}</span>
                                                ${o.provider?.rating ? `<span class="text-yellow-400 text-xs">${getRatingStars(o.provider.rating)}</span>` : ''}
                                            </div>
                                            <p class="text-[#ff9900] font-bold mt-1">PKR ${o.price}</p>
                                            ${o.message ? `<p class="text-[#a0a0a0] text-xs mt-1">${o.message}</p>` : ''}
                                        </div>
                                        <button onclick="window.acceptOffer('${o.id}', '${req.id}')" class="bg-[#ff9900] hover:bg-[#e47911] text-white px-4 py-2 rounded-lg text-sm">
                                            Accept Offer
                                        </button>
                                    </div>
                                </div>
                            `).join('')
                        }
                    </div>
                </div>
            `;
        }
        
        container.innerHTML = html;
    } catch (error) {
        console.error('Load active requests error:', error);
    }
}

async function loadNearbyRequests() {
    if (!store.currentUser || store.currentUser.role !== 'PROVIDER') {
        document.getElementById('nearby-requests-container').innerHTML = '<p class="text-[#a0a0a0] text-center py-4">Login as provider to see requests</p>';
        return;
    }

    if (!store.currentUser.lat || !store.currentUser.lng) {
        document.getElementById('nearby-requests-container').innerHTML = '<p class="text-[#a0a0a0] text-center py-4">Set your location to see nearby requests</p>';
        return;
    }

    try {
        const requests = await store.getNearbyRequests(store.currentUser.id);
        const container = document.getElementById('nearby-requests-container');
        
        if (requests.length === 0) {
            container.innerHTML = '<p class="text-[#a0a0a0] text-center py-4">No nearby requests found</p>';
            return;
        }

        container.innerHTML = requests.map(req => {
            const distance = store.calculateDistance(
                store.currentUser.lat, store.currentUser.lng,
                req.lat, req.lng
            ).toFixed(1);
            
            return `
                <div class="bg-[#1e1e1e] rounded-xl p-4 border border-[#2a2a2a]">
                    <div class="flex justify-between items-start">
                        <div>
                            <span class="px-2 py-1 bg-[#ff9900]/20 text-[#ff9900] rounded-full text-xs">${req.category}</span>
                            <h4 class="text-white font-semibold mt-2">${req.description}</h4>
                            <p class="text-[#a0a0a0] text-sm mt-1">Customer offers: PKR ${req.price}</p>
                            <div class="flex items-center gap-2 mt-2">
                                <i class="fas fa-map-marker-alt text-[#ff9900] text-xs"></i>
                                <span class="text-[#a0a0a0] text-xs">${distance} km away</span>
                            </div>
                        </div>
                        <button onclick="window.showMakeOfferModal('${req.id}', '${req.seeker_id}', '${req.price}', '${req.description}')" class="bg-[#ff9900] hover:bg-[#e47911] text-white px-4 py-2 rounded-lg text-sm">
                            Make Offer
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Load nearby requests error:', error);
        document.getElementById('nearby-requests-container').innerHTML = '<p class="text-[#a0a0a0] text-center py-4">Error loading requests</p>';
    }
}

function showMakeOfferModal(requestId, seekerId, customerPrice, description) {
    document.getElementById('offer-request-id').value = requestId;
    document.getElementById('offer-seeker-id').value = seekerId;
    document.getElementById('offer-request-details').innerHTML = `
        <p class="text-[#a0a0a0] text-sm">Service: ${description}</p>
        <p class="text-[#a0a0a0] text-sm mt-2">Customer's price: PKR ${customerPrice}</p>
    `;
    document.getElementById('offer-price').value = customerPrice;
    document.getElementById('offer-message').value = '';
    document.getElementById('make-offer-error').classList.add('hidden');
    showModal('make-offer-modal');
}

async function handleMakeOffer(data) {
    showLoading(true);
    try {
        const result = await store.createOffer({
            request_id: data.request_id,
            seeker_id: data.seeker_id,
            price: data.price,
            message: data.message
        });

        if (result.success) {
            showAlert('success', result.message);
            hideModal('make-offer-modal');
            await loadNearbyRequests();
        } else {
            const err = document.getElementById('make-offer-error');
            if (err) {
                err.querySelector('span').textContent = result.error;
                err.classList.remove('hidden');
            }
        }
    } catch (error) {
        showAlert('error', error.message);
    } finally {
        showLoading(false);
    }
}

async function acceptOffer(offerId, requestId) {
    if (!confirm('Are you sure you want to accept this offer?')) return;
    
    showLoading(true);
    try {
        const result = await store.acceptOffer(offerId, requestId);
        
        if (result.success) {
            showAlert('success', result.message);
            await loadSeekerActiveRequests();
            await loadSeekerDashboard();
        } else {
            showAlert('error', result.error);
        }
    } catch (error) {
        showAlert('error', error.message);
    } finally {
        showLoading(false);
    }
}

// ===== RATING MODAL =====
function showRatingModal(bookingId, targetId, targetRole, raterRole) {
    document.getElementById('rating-booking-id').value = bookingId;
    document.getElementById('rating-target-id').value = targetId;
    document.getElementById('rating-target-role').value = targetRole;
    document.getElementById('rating-rater-role').value = raterRole;
    document.getElementById('rating-value').value = '0';
    document.getElementById('rating-comment').value = '';
    document.getElementById('rating-error').classList.add('hidden');
    
    const title = document.getElementById('rating-modal-title');
    const subtitle = document.getElementById('rating-modal-subtitle');
    
    if (targetRole === 'PROVIDER') {
        title.textContent = 'Rate the Provider';
        subtitle.textContent = 'How was your experience with the provider?';
    } else {
        title.textContent = 'Rate the Customer';
        subtitle.textContent = 'How was your experience with the customer?';
    }
    
    document.querySelectorAll('#rating-stars i').forEach(star => {
        star.className = 'far fa-star cursor-pointer hover:text-yellow-400 text-4xl';
    });
    
    showModal('rating-modal');
    
    document.querySelectorAll('#rating-stars i').forEach((star, index) => {
        star.onclick = function() {
            const rating = parseInt(this.dataset.rating);
            document.getElementById('rating-value').value = rating;
            document.querySelectorAll('#rating-stars i').forEach((s, idx) => {
                s.className = idx < rating ? 'fas fa-star text-yellow-400 text-4xl' : 'far fa-star text-4xl';
            });
        };
    });
}

async function handleSubmitRating(bookingId, targetId, targetRole, raterRole, rating, comment) {
    if (!rating || rating === '0') {
        showAlert('error', 'Please select a rating');
        return;
    }
    
    showLoading(true);
    try {
        const result = await store.submitRating(bookingId, targetId, targetRole, raterRole, rating, comment);
        
        if (result.success) {
            showAlert('success', result.message);
            hideModal('rating-modal');
            
            if (store.currentUser.role === 'PROVIDER') {
                await loadProviderDashboard();
            } else {
                await loadSeekerDashboard();
            }
        } else {
            const err = document.getElementById('rating-error');
            if (err) {
                err.querySelector('span').textContent = result.error;
                err.classList.remove('hidden');
            }
        }
    } catch (error) {
        showAlert('error', error.message);
    } finally {
        showLoading(false);
    }
}

// ===== CANCEL ORDER MODAL =====
function showCancelOrderModal(bookingId) {
    document.getElementById('cancel-booking-id').value = bookingId;
    document.getElementById('cancel-order-error').classList.add('hidden');
    document.getElementById('cancel-reason').value = '';
    document.getElementById('cancel-details').value = '';
    showModal('cancel-order-modal');
}

async function handleCancelOrder(bookingId, reason, details) {
    showLoading(true);
    try {
        const result = await store.cancelBooking(bookingId, reason, details);
        
        if (result.success) {
            showAlert('success', result.message);
            hideModal('cancel-order-modal');
            
            if (store.currentUser.role === 'PROVIDER') {
                await loadProviderDashboard();
            } else {
                await loadSeekerDashboard();
            }
        } else {
            const err = document.getElementById('cancel-order-error');
            if (err) {
                err.querySelector('span').textContent = result.error;
                err.classList.remove('hidden');
            }
        }
    } catch (error) {
        showAlert('error', error.message);
    } finally {
        showLoading(false);
    }
}

// ===== NOTIFICATIONS =====
async function loadNotifications() {
    if (!store.currentUser) return;
    
    const container = document.getElementById('notifications-container');
    if (!container) return;
    
    showLoading(true);
    try {
        const notifications = await store.getNotifications(store.currentUser.id);
        
        if (notifications.length === 0) {
            container.innerHTML = `
                <div class="text-center py-16 bg-[#121212] rounded-2xl border border-[#2a2a2a]">
                    <i class="fas fa-bell text-5xl text-[#a0a0a0] mb-4"></i>
                    <p class="text-[#e0e0e0] text-lg">No notifications yet</p>
                    <p class="text-[#a0a0a0] text-sm mt-2">Service requests and offers will appear here</p>
                </div>
            `;
            return;
        }
        
        let html = '';
        notifications.forEach(notif => {
            const isUnread = !notif.is_read;
            const data = notif.data || {};
            
            html += `
                <div class="bg-[${isUnread ? '#1e1e1e' : '#121212'}] rounded-xl p-6 border border-[#2a2a2a] hover:border-[#ff9900] transition-all ${isUnread ? 'border-l-4 border-l-[#ff9900]' : ''}">
                    <div class="flex items-start gap-4">
                        <div class="relative">
                            <div class="w-12 h-12 rounded-full bg-[#${notif.type === 'PAYMENT_REQUEST' ? 'ff9900' : notif.type === 'NEW_OFFER' ? 'ff9900' : notif.type === 'ORDER_CANCELLED' ? 'ff0000' : 'ff9900'}]/20 flex items-center justify-center">
                                <i class="fas fa-${notif.type === 'PAYMENT_REQUEST' ? 'money-bill-wave' : notif.type === 'NEW_OFFER' ? 'hand-holding-usd' : notif.type === 'ORDER_CANCELLED' ? 'times-circle' : notif.type === 'RATING_RECEIVED' ? 'star' : 'bell'} text-[#${notif.type === 'PAYMENT_REQUEST' ? 'ff9900' : notif.type === 'NEW_OFFER' ? 'ff9900' : notif.type === 'ORDER_CANCELLED' ? 'ff0000' : notif.type === 'RATING_RECEIVED' ? 'ff9900' : 'ff9900'}] text-xl"></i>
                            </div>
                            ${isUnread ? '<span class="absolute -top-1 -right-1 w-3 h-3 bg-[#ff9900] rounded-full animate-ping"></span>' : ''}
                        </div>
                        <div class="flex-1">
                            <div class="flex justify-between items-start">
                                <h4 class="text-white font-bold text-lg">${notif.title}</h4>
                                <span class="text-[#a0a0a0] text-xs">${new Date(notif.created_at).toLocaleString()}</span>
                            </div>
                            <p class="text-[#e0e0e0] mt-1">${notif.message}</p>
                            ${data.price ? `
                                <div class="flex items-center gap-2 mt-3">
                                    <span class="text-[#ff9900] font-bold text-xl">PKR ${data.price}</span>
                                    <span class="text-[#a0a0a0] text-sm">from ${data.provider_name || data.rater_name || 'User'}</span>
                                </div>
                            ` : ''}
                            <div class="flex items-center gap-3 mt-4">
                                ${isUnread ? `
                                    <button onclick="window.markNotificationRead('${notif.id}')" class="bg-[#232f3e] hover:bg-[#37475a] text-white px-4 py-2 rounded-lg text-sm transition-all">
                                        <i class="fas fa-check mr-1"></i> Mark Read
                                    </button>
                                ` : ''}
                                ${notif.type === 'PAYMENT_REQUEST' ? `
                                    <button onclick="window.showProcessPaymentModal('${data.payment_id}', '${data.booking_id}')" class="bg-[#ff9900] hover:bg-[#e47911] text-white px-4 py-2 rounded-lg text-sm transition-all">
                                        <i class="fas fa-credit-card mr-1"></i> Pay Now
                                    </button>
                                ` : ''}
                                ${notif.type === 'RATING_RECEIVED' && data.rater_id ? `
                                    <button onclick="window.viewPublicProfile('${data.rater_id}')" class="bg-[#ff9900] hover:bg-[#e47911] text-white px-4 py-2 rounded-lg text-sm transition-all">
                                        <i class="fas fa-user mr-1"></i> View Rater
                                    </button>
                                ` : ''}
                            </div>
                        </div>
                    </div>
                </div>
            `;
        });
        
        container.innerHTML = html;
        
    } catch (error) {
        console.error('Load notifications error:', error);
    } finally {
        showLoading(false);
    }
}

async function markNotificationRead(notificationId) {
    showLoading(true);
    try {
        await store.markNotificationRead(notificationId);
        await loadNotifications();
        updateNotificationBadges();
        showAlert('success', 'Notification marked as read');
    } catch (error) {
        showAlert('error', error.message);
    } finally {
        showLoading(false);
    }
}

async function markAllNotificationsRead() {
    if (!store.currentUser) return;
    showLoading(true);
    try {
        await store.markAllNotificationsRead(store.currentUser.id);
        await loadNotifications();
        updateNotificationBadges();
        showAlert('success', 'All notifications marked as read');
    } catch (error) {
        showAlert('error', error.message);
    } finally {
        showLoading(false);
    }
}

// ===== UPDATE NOTIFICATION BADGES =====
function updateNotificationBadges() {
    const totalUnread = store.unreadNotifications.size + store.unreadPayments.size + store.unreadChats.size + store.unreadRequests.size;
    
    const bellBadge = document.getElementById('notification-badge');
    const mobileBellBadge = document.getElementById('mobile-notification-badge');
    const seekerPaymentBadge = document.getElementById('seeker-payment-badge');
    
    if (bellBadge) {
        if (totalUnread > 0) {
            bellBadge.textContent = totalUnread > 9 ? '9+' : totalUnread;
            bellBadge.classList.remove('hidden');
        } else {
            bellBadge.classList.add('hidden');
        }
    }
    
    if (mobileBellBadge) {
        if (totalUnread > 0) {
            mobileBellBadge.textContent = totalUnread > 9 ? '9+' : totalUnread;
            mobileBellBadge.classList.remove('hidden');
        } else {
            mobileBellBadge.classList.add('hidden');
        }
    }
    
    if (seekerPaymentBadge) {
        const paymentUnread = store.unreadPayments.size;
        if (paymentUnread > 0) {
            seekerPaymentBadge.textContent = paymentUnread > 9 ? '9+' : paymentUnread;
            seekerPaymentBadge.classList.remove('hidden');
        } else {
            seekerPaymentBadge.classList.add('hidden');
        }
    }
}

// ===== UPDATE NAVIGATION =====
function updateNavigation() {
    const authNav = document.getElementById('auth-nav');
    const mobileAuthNav = document.getElementById('mobile-auth-nav');
    
    if (store.currentUser) {
        const u = store.currentUser;
        const avatar = u.name?.charAt(0).toUpperCase() || 'U';
        const ratingStars = getRatingStars(u.rating || 0);
        
        authNav.innerHTML = `
            <div class="flex items-center gap-3">
                <button onclick="window.viewPublicProfile('${u.id}')" class="flex items-center gap-2 bg-[#1e1e1e] hover:bg-[#2a2a2a] px-3 py-2 rounded-xl border border-[#2a2a2a] transition-all">
                    <div class="w-8 h-8 rounded-full bg-[#ff9900] flex items-center justify-center text-white font-bold text-sm">${avatar}</div>
                    <div class="hidden lg:block text-left">
                        <div class="text-white text-sm font-semibold">${u.name}</div>
                        <div class="text-[#a0a0a0] text-xs flex items-center gap-1">
                            <span class="capitalize">${u.role.toLowerCase()}</span>
                            <span class="text-yellow-400">${ratingStars}</span>
                            <span>(${u.rating?.toFixed(1) || '0.0'})</span>
                        </div>
                    </div>
                </button>
                ${u.role === 'PROVIDER' ? `
                    <button onclick="window.showPage('provider-payment-requests')" class="bg-[#ff9900] hover:bg-[#e47911] text-white px-3 py-2 rounded-xl text-sm font-medium transition-all">
                        <i class="fas fa-credit-card mr-1"></i> Requests
                    </button>
                ` : ''}
                <button onclick="window.handleLogout()" class="bg-red-900/30 hover:bg-red-900/50 text-red-200 px-4 py-2 rounded-xl text-sm font-medium transition-all">
                    <i class="fas fa-sign-out-alt mr-1"></i> Logout
                </button>
            </div>
        `;
        
        mobileAuthNav.innerHTML = `
            <button onclick="window.viewPublicProfile('${u.id}')" class="w-full text-left py-2 text-[#e0e0e0] hover:text-white">
                My Profile (${u.rating?.toFixed(1) || '0.0'} ★)
            </button>
            ${u.role === 'PROVIDER' ? `
                <button onclick="window.showPage('provider-payment-requests')" class="w-full text-left py-2 text-[#ff9900] hover:text-[#e47911]">Payment Requests</button>
            ` : ''}
            <button onclick="window.handleLogout()" class="w-full text-left py-2 text-red-300 hover:text-red-200">Logout</button>
        `;
    } else {
        authNav.innerHTML = `
            <div class="flex items-center gap-3">
                <button onclick="window.showPage('seeker-login')" class="bg-[#232f3e] hover:bg-[#37475a] text-white px-4 py-2 rounded-xl text-sm font-medium transition-all">
                    <i class="fas fa-search mr-1"></i> Find Services
                </button>
                <button onclick="window.showPage('provider-login')" class="bg-[#ff9900] hover:bg-[#e47911] text-white px-4 py-2 rounded-xl text-sm font-medium transition-all">
                    <i class="fas fa-briefcase mr-1"></i> Offer Services
                </button>
            </div>
        `;
        
        mobileAuthNav.innerHTML = `
            <button onclick="window.showPage('seeker-login')" class="w-full text-left py-2 text-[#e0e0e0] hover:text-white">Find Services</button>
            <button onclick="window.showPage('provider-login')" class="w-full text-left py-2 text-[#ff9900] hover:text-[#e47911]">Become a Provider</button>
        `;
    }
    
    updateNotificationBadges();
}

// ===== GET RATING STARS =====
function getRatingStars(rating) {
    const fullStars = Math.floor(rating);
    const halfStar = rating % 1 >= 0.5 ? 1 : 0;
    const emptyStars = 5 - fullStars - halfStar;
    
    return '★'.repeat(fullStars) + (halfStar ? '½' : '') + '☆'.repeat(emptyStars);
}

// ===== LANDING PAGE =====
async function loadLandingPage() {
    try {
        const stats = await store.getStats();
        document.getElementById('stats-users').textContent = stats.totalUsers;
        document.getElementById('stats-providers').textContent = stats.totalProviders;
        document.getElementById('stats-services').textContent = stats.totalServices;
        document.getElementById('stats-reviews').textContent = stats.totalReviews;
        
        const reviews = await store.getRecentReviews(6);
        const grid = document.getElementById('landing-reviews-grid');
        
        if (reviews.length === 0) {
            grid.innerHTML = '<div class="bg-[#121212] rounded-2xl p-8 text-center border border-[#2a2a2a] col-span-3"><i class="far fa-star text-5xl text-[#a0a0a0] mb-4"></i><p class="text-[#e0e0e0] text-lg">No reviews yet</p></div>';
        } else {
            grid.innerHTML = reviews.map(r => {
                const ratingStars = getRatingStars(r.rating);
                return `
                    <div class="bg-[#121212] rounded-2xl p-6 border border-[#2a2a2a] hover:border-[#ff9900] transition-all">
                        <div class="flex items-center gap-3 mb-4">
                            <div class="w-12 h-12 rounded-full bg-[#ff9900]/20 flex items-center justify-center text-[#ff9900] font-bold">
                                ${(r.rater?.name || 'A').charAt(0).toUpperCase()}
                            </div>
                            <div>
                                <div class="font-semibold text-white">${r.rater?.name || 'Anonymous'}</div>
                                <div class="flex items-center gap-1 text-yellow-400 text-sm">
                                    ${ratingStars}
                                </div>
                                <div class="text-[#a0a0a0] text-xs">rated ${r.target_role?.toLowerCase() || 'user'}</div>
                            </div>
                        </div>
                        <p class="text-[#e0e0e0] line-clamp-3">${r.comment || 'Great experience!'}</p>
                    </div>
                `;
            }).join('');
        }

        if (store.currentUser && store.currentUser.address) {
            document.getElementById('user-location-display').textContent = store.currentUser.address;
        }
    } catch (error) {
        console.error('Landing error:', error);
    }
}

// ===== SEEKER DASHBOARD =====
async function loadSeekerDashboard() {
    if (!store.currentUser || store.currentUser.role !== 'SEEKER') { 
        showPage('landing'); 
        return; 
    }
    
    const user = store.currentUser;
    document.getElementById('seeker-greeting').textContent = `Welcome, ${user.name}!`;
    
    try {
        const bookings = await store.getUserBookings(user.id);
        const favorites = await store.getUserFavorites(user.id);
        const payments = await store.getSeekerPayments(user.id);
        const requests = await store.getUserRequests(user.id, 'SEEKER');
        
        document.getElementById('seeker-total-bookings').textContent = bookings.length + requests.length;
        document.getElementById('seeker-pending').textContent = bookings.filter(b => b.status === 'REQUESTED').length;
        document.getElementById('seeker-approved').textContent = bookings.filter(b => b.status === 'APPROVED').length;
        document.getElementById('seeker-completed').textContent = bookings.filter(b => b.status === 'COMPLETED').length;
        
        const favGrid = document.getElementById('seeker-favorites-grid');
        if (favorites.length === 0) {
            favGrid.innerHTML = '<div class="col-span-3 text-center py-12 bg-[#121212] rounded-xl border border-[#2a2a2a]"><i class="far fa-heart text-5xl text-[#a0a0a0] mb-4"></i><p class="text-[#e0e0e0]">No favorites yet</p></div>';
        } else {
            favGrid.innerHTML = favorites.slice(0, 3).map(s => {
                const providerRating = s.provider?.rating ? getRatingStars(s.provider.rating) : '';
                const distance = (store.currentUser.lat && s.provider?.lat) ? 
                    store.calculateDistance(store.currentUser.lat, store.currentUser.lng, s.provider.lat, s.provider.lng).toFixed(1) : null;
                
                return `
                    <div class="bg-[#121212] rounded-2xl p-6 border border-[#2a2a2a] hover:border-[#ff9900] transition-all">
                        <h4 class="text-white font-bold text-lg mb-2">${s.title}</h4>
                        <p class="text-[#e0e0e0] text-sm mb-4">${s.description?.substring(0, 60)}...</p>
                        <div class="flex items-center justify-between mb-2">
                            <span class="text-[#ff9900] font-bold">PKR ${s.price}</span>
                            ${providerRating ? `<span class="text-yellow-400 text-sm">${providerRating}</span>` : ''}
                        </div>
                        ${distance ? `<p class="text-[#a0a0a0] text-xs mb-3">📍 ${distance} km away</p>` : ''}
                        <button onclick="window.showBookServiceModal('${s.id}')" class="w-full bg-[#ff9900] hover:bg-[#e47911] text-white px-4 py-2 rounded-lg text-sm">Book Now</button>
                    </div>
                `;
            }).join('');
        }
        
        const container = document.getElementById('seeker-recent-bookings');
        if (bookings.length === 0 && requests.length === 0) {
            container.innerHTML = '<div class="bg-[#121212] rounded-2xl p-12 text-center border border-[#2a2a2a]"><p class="text-[#e0e0e0] text-lg">No bookings or requests yet</p></div>';
        } else {
            const allItems = [...bookings, ...requests.map(r => ({...r, type: 'request'}))];
            container.innerHTML = allItems.slice(0, 5).map(item => {
                if (item.type === 'request') {
                    return `
                        <div class="bg-[#121212] rounded-2xl p-6 border border-[#2a2a2a]">
                            <div class="flex justify-between items-start">
                                <div>
                                    <span class="px-2 py-1 bg-[#ff9900]/20 text-[#ff9900] rounded-full text-xs">REQUEST</span>
                                    <h4 class="text-white font-bold text-lg mt-2">${item.description}</h4>
                                    <p class="text-[#e0e0e0] text-sm">Category: ${item.category}</p>
                                    <span class="text-[#ff9900] font-bold">PKR ${item.price}</span>
                                    <p class="text-[#a0a0a0] text-xs mt-2">📍 ${item.address}</p>
                                </div>
                                <span class="px-3 py-1 rounded-full text-xs font-bold bg-green-900/30 text-green-300">${item.status}</span>
                            </div>
                        </div>
                    `;
                } else {
                    const hasPendingPayment = payments.some(p => p.booking_id === item.id && p.status === 'PENDING');
                    const payment = payments.find(p => p.booking_id === item.id);
                    const providerRating = item.provider?.rating ? getRatingStars(item.provider.rating) : '';
                    
                    return `
                        <div class="bg-[#121212] rounded-2xl p-6 border border-[#2a2a2a]">
                            <div class="flex justify-between items-start">
                                <div>
                                    <h4 class="text-white font-bold text-lg">${item.service?.title || 'Service'}</h4>
                                    <div class="flex items-center gap-2">
                                        <p class="text-[#e0e0e0] text-sm">Provider: ${item.provider?.name || 'Provider'}</p>
                                        ${providerRating ? `<span class="text-yellow-400 text-xs">${providerRating}</span>` : ''}
                                    </div>
                                    <span class="text-[#ff9900] font-bold">PKR ${item.price?.toFixed(2)}</span>
                                    ${item.cancellation_reason ? `<p class="text-red-400 text-xs mt-2">Cancelled: ${item.cancellation_reason}</p>` : ''}
                                </div>
                                <div class="flex flex-col items-end gap-2">
                                    <span class="px-3 py-1 rounded-full text-xs font-bold ${getStatusClass(item.status)}">${item.status}</span>
                                    ${item.status === 'REQUESTED' ? `
                                        <button onclick="window.showCancelOrderModal('${item.id}')" class="px-3 py-1 bg-red-900/30 hover:bg-red-900/50 text-red-300 rounded-full text-xs">
                                            Cancel Order
                                        </button>
                                    ` : ''}
                                    ${hasPendingPayment ? `
                                        <button onclick="window.showProcessPaymentModal('${payment?.id}', '${item.id}')" class="px-3 py-1 bg-[#ff9900] hover:bg-[#e47911] text-white rounded-full text-xs">
                                            Pay Now
                                        </button>
                                    ` : ''}
                                    ${item.status === 'COMPLETED' ? `
                                        <button onclick="window.showRatingModal('${item.id}', '${item.provider_id}', 'PROVIDER', 'SEEKER')" class="px-3 py-1 bg-[#ff9900] hover:bg-[#e47911] text-white rounded-full text-xs">
                                            Rate Provider
                                        </button>
                                    ` : ''}
                                </div>
                            </div>
                        </div>
                    `;
                }
            }).join('');
        }
    } catch (error) {
        console.error('Seeker dashboard error:', error);
    }
}

// ===== PROVIDER DASHBOARD =====
async function loadProviderDashboard() {
    if (!store.currentUser || store.currentUser.role !== 'PROVIDER') { 
        showPage('landing'); 
        return; 
    }
    
    const user = store.currentUser;
    document.getElementById('provider-greeting').textContent = `Welcome, ${user.name}!`;
    
    try {
        const services = await store.getServicesByProvider(user.id);
        const bookings = await store.getUserBookings(user.id);
        const payments = await store.getProviderPayments(user.id);
        const ratingStats = await store.getUserRatingStats(user.id);
        
        document.getElementById('provider-active-services').textContent = services.filter(s => s.is_active).length;
        document.getElementById('provider-total-bookings').textContent = bookings.length;
        document.getElementById('provider-pending').textContent = bookings.filter(b => b.status === 'REQUESTED').length;
        
        const revenue = payments.filter(p => p.status === 'COMPLETED').reduce((sum, p) => sum + (p.amount || 0), 0);
        document.getElementById('provider-revenue').textContent = `PKR ${revenue.toFixed(2)}`;
        
        document.getElementById('provider-rating').textContent = ratingStats.average.toFixed(1);
        document.getElementById('provider-stars').textContent = getRatingStars(ratingStats.average);
        document.getElementById('provider-review-count').textContent = `(${ratingStats.total} reviews)`;
        
        const servicesGrid = document.getElementById('provider-services-grid');
        if (services.length === 0) {
            servicesGrid.innerHTML = '<div class="col-span-3 text-center py-12 bg-[#121212] rounded-xl border border-[#2a2a2a]"><p class="text-[#e0e0e0]">No services yet</p></div>';
        } else {
            servicesGrid.innerHTML = services.map(s => `
                <div class="bg-[#121212] rounded-2xl p-6 border border-[#2a2a2a]">
                    <div class="flex justify-between items-start mb-3">
                        <span class="px-3 py-1 bg-[#ff9900]/20 text-[#ff9900] rounded-full text-xs">${s.category}</span>
                        <span class="px-3 py-1 ${s.is_active ? 'bg-green-900/30 text-green-300' : 'bg-red-900/30 text-red-300'} rounded-full text-xs">${s.is_active ? 'Active' : 'Inactive'}</span>
                    </div>
                    <h4 class="text-white font-bold text-lg mb-2">${s.title}</h4>
                    <p class="text-[#e0e0e0] text-sm mb-4">${s.description}</p>
                    <div class="flex justify-between items-center">
                        <span class="text-[#ff9900] font-bold">PKR ${s.price}</span>
                        <div class="flex gap-2">
                            <button onclick="window.toggleServiceStatus('${s.id}', ${!s.is_active})" class="bg-[#1e1e1e] hover:bg-[#2a2a2a] text-white px-3 py-1 rounded-lg text-sm">
                                ${s.is_active ? 'Deactivate' : 'Activate'}
                            </button>
                            <button onclick="window.showDeleteServiceModal('${s.id}')" class="bg-red-900/30 hover:bg-red-900/50 text-red-300 px-3 py-1 rounded-lg text-sm">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `).join('');
        }
        
        const bookingsContainer = document.getElementById('provider-recent-bookings');
        if (bookings.length === 0) {
            bookingsContainer.innerHTML = '<div class="bg-[#121212] rounded-2xl p-12 text-center border border-[#2a2a2a]"><p class="text-[#e0e0e0]">No bookings yet</p></div>';
        } else {
            bookingsContainer.innerHTML = bookings.slice(0, 5).map(b => {
                const payment = payments.find(p => p.booking_id === b.id);
                const seekerRating = b.seeker?.rating ? getRatingStars(b.seeker.rating) : '';
                
                return `
                    <div class="bg-[#121212] rounded-2xl p-6 border border-[#2a2a2a]">
                        <div class="flex justify-between items-start">
                            <div>
                                <h4 class="text-white font-bold text-lg">${b.service?.title || 'Service'}</h4>
                                <div class="flex items-center gap-2">
                                    <p class="text-[#e0e0e0] text-sm">Customer: ${b.seeker?.name || 'Customer'}</p>
                                    ${seekerRating ? `<span class="text-yellow-400 text-xs">${seekerRating}</span>` : ''}
                                </div>
                                <span class="text-[#ff9900] font-bold">PKR ${b.price?.toFixed(2)}</span>
                                ${b.cancellation_reason ? `<p class="text-red-400 text-xs mt-2">Cancelled: ${b.cancellation_reason}</p>` : ''}
                            </div>
                            <div class="flex flex-col items-end gap-2">
                                <span class="px-3 py-1 rounded-full text-xs font-bold ${getStatusClass(b.status)}">${b.status}</span>
                                ${b.status === 'APPROVED' && !payment ? `
                                    <button onclick="window.showRequestPaymentModal('${b.id}')" class="bg-[#ff9900] hover:bg-[#e47911] text-white px-4 py-2 rounded-lg text-sm">
                                        Request Payment
                                    </button>
                                ` : ''}
                                ${b.status === 'REQUESTED' ? `
                                    <div class="flex gap-2">
                                        <button onclick="window.handleApproveBooking('${b.id}')" class="bg-green-900/30 hover:bg-green-900/50 text-green-300 px-3 py-1 rounded-lg text-xs">
                                            Approve
                                        </button>
                                        <button onclick="window.handleRejectBooking('${b.id}')" class="bg-red-900/30 hover:bg-red-900/50 text-red-300 px-3 py-1 rounded-lg text-xs">
                                            Reject
                                        </button>
                                    </div>
                                ` : ''}
                                ${b.status === 'REQUESTED' || b.status === 'APPROVED' ? `
                                    <button onclick="window.showCancelOrderModal('${b.id}')" class="text-red-400 hover:text-red-300 text-xs">
                                        Cancel Order
                                    </button>
                                ` : ''}
                                ${payment && payment.status === 'PENDING' ? `
                                    <span class="px-3 py-1 bg-yellow-900/30 text-yellow-300 rounded-full text-xs">Payment Pending</span>
                                ` : ''}
                                ${payment && payment.status === 'COMPLETED' ? `
                                    <span class="px-3 py-1 bg-green-900/30 text-green-300 rounded-full text-xs">Paid</span>
                                ` : ''}
                                ${b.status === 'COMPLETED' ? `
                                    <button onclick="window.showRatingModal('${b.id}', '${b.seeker_id}', 'SEEKER', 'PROVIDER')" class="px-3 py-1 bg-[#ff9900] hover:bg-[#e47911] text-white rounded-full text-xs">
                                        Rate Customer
                                    </button>
                                ` : ''}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }
        
        await loadPaymentHistoryTable(payments);
        
    } catch (error) {
        console.error('Provider dashboard error:', error);
    }
}

// ===== PAYMENT HISTORY =====
async function loadPaymentHistoryTable(payments) {
    const tableBody = document.getElementById('payment-history-table');
    if (!tableBody) return;
    
    if (!payments || payments.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-[#a0a0a0]">No payment history yet</td></tr>';
        return;
    }
    
    tableBody.innerHTML = payments.slice(0, 10).map(p => `
        <tr class="border-b border-[#2a2a2a] hover:bg-[#1e1e1e]">
            <td class="py-4 px-2 text-white">${new Date(p.created_at).toLocaleDateString()}</td>
            <td class="py-4 px-2 text-white">${p.booking?.service?.title || 'Service'}</td>
            <td class="py-4 px-2 text-white">${store.currentUser?.role === 'PROVIDER' ? p.seeker?.name : p.provider?.name || 'User'}</td>
            <td class="py-4 px-2 text-[#ff9900] font-bold">PKR ${p.amount}</td>
            <td class="py-4 px-2 text-[#e0e0e0]">${p.method}</td>
            <td class="py-4 px-2">
                <span class="px-3 py-1 rounded-full text-xs font-bold ${getPaymentStatusClass(p.status)}">${p.status}</span>
            </td>
        </tr>
    `).join('');
}

async function loadPaymentHistory() {
    if (!store.currentUser) return;
    
    try {
        let payments = [];
        if (store.currentUser.role === 'PROVIDER') {
            payments = await store.getProviderPayments(store.currentUser.id);
            document.getElementById('total-received').textContent = `PKR ${payments.filter(p => p.status === 'COMPLETED').reduce((s, p) => s + p.amount, 0).toFixed(2)}`;
            document.getElementById('pending-payments').textContent = payments.filter(p => p.status === 'PENDING').length;
            document.getElementById('completed-payments').textContent = payments.filter(p => p.status === 'COMPLETED').length;
        } else {
            payments = await store.getSeekerPayments(store.currentUser.id);
            document.getElementById('total-received').textContent = `PKR ${payments.filter(p => p.status === 'COMPLETED').reduce((s, p) => s + p.amount, 0).toFixed(2)}`;
            document.getElementById('pending-payments').textContent = payments.filter(p => p.status === 'PENDING').length;
            document.getElementById('completed-payments').textContent = payments.filter(p => p.status === 'COMPLETED').length;
        }
        await loadPaymentHistoryTable(payments);
    } catch (error) {
        console.error('Load payment history error:', error);
    }
}

// ===== SEEKER MARKETPLACE =====
async function loadSeekerMarketplace() {
    showLoading(true);
    try {
        const search = document.getElementById('seeker-search')?.value?.trim();
        const category = document.getElementById('seeker-category')?.value;
        
        const filters = { search: search || null, category: category || null };
        const services = await store.getServices(filters);
        
        const categories = [...new Set(services.map(s => s.category))];
        const catSelect = document.getElementById('seeker-category');
        if (catSelect) {
            catSelect.innerHTML = '<option value="">All Categories</option>' + 
                categories.map(c => `<option value="${c}">${c}</option>`).join('');
        }
        
        const grid = document.getElementById('seeker-services-grid');
        const noResults = document.getElementById('seeker-no-results');
        
        if (services.length === 0) {
            grid.classList.add('hidden');
            noResults.classList.remove('hidden');
        } else {
            grid.classList.remove('hidden');
            noResults.classList.add('hidden');
            
            let favorites = [];
            if (store.currentUser) {
                favorites = await store.getUserFavorites(store.currentUser.id);
            }
            const favIds = favorites.map(f => f.id);
            
            grid.innerHTML = services.map(s => {
                const isFav = favIds.includes(s.id);
                const providerRating = s.provider?.rating ? getRatingStars(s.provider.rating) : '';
                const distance = (store.currentUser?.lat && s.provider?.lat) ? 
                    store.calculateDistance(store.currentUser.lat, store.currentUser.lng, s.provider.lat, s.provider.lng).toFixed(1) : null;
                
                return `
                    <div class="bg-[#121212] rounded-2xl p-6 border border-[#2a2a2a] hover:border-[#ff9900] transition-all">
                        <div class="flex justify-between items-start mb-4">
                            <span class="px-3 py-1 bg-[#ff9900]/20 text-[#ff9900] rounded-full text-xs">${s.category}</span>
                            <div class="flex items-center gap-2">
                                ${store.currentUser ? `
                                    <button onclick="window.toggleFavorite('${s.id}')" class="text-2xl ${isFav ? 'text-[#ff9900]' : 'text-[#a0a0a0] hover:text-[#ff9900]'}">
                                        <i class="${isFav ? 'fas' : 'far'} fa-heart"></i>
                                    </button>
                                ` : ''}
                                <span class="text-xl font-bold text-[#ff9900]">PKR ${s.price}</span>
                            </div>
                        </div>
                        <h3 class="text-xl font-bold text-white mb-3">${s.title}</h3>
                        <p class="text-[#e0e0e0] text-sm mb-4 line-clamp-2">${s.description}</p>
                        <div class="flex items-center justify-between mb-4">
                            <div class="flex items-center text-[#e0e0e0] text-sm">
                                <i class="fas fa-user mr-2"></i>
                                <button onclick="window.viewPublicProfile('${s.provider_id}')" class="hover:text-[#ff9900]">${s.provider?.name || 'Provider'}</button>
                            </div>
                            ${providerRating ? `<div class="flex items-center text-yellow-400 text-sm">${providerRating}</div>` : ''}
                        </div>
                        ${distance ? `<p class="text-[#a0a0a0] text-xs mb-3">📍 ${distance} km away</p>` : ''}
                        <div class="flex justify-end">
                            ${store.currentUser ? `
                                <button onclick="window.showBookServiceModal('${s.id}')" class="bg-[#ff9900] hover:bg-[#e47911] text-white px-6 py-3 rounded-lg text-sm font-semibold">
                                    Book Now
                                </button>
                            ` : `
                                <button onclick="window.showPage('seeker-login')" class="bg-[#ff9900] hover:bg-[#e47911] text-white px-6 py-3 rounded-lg text-sm font-semibold">
                                    Login to Book
                                </button>
                            `}
                        </div>
                    </div>
                `;
            }).join('');
        }

        if (store.currentUser && store.currentUser.address) {
            document.getElementById('user-location-display').textContent = store.currentUser.address;
        }
    } catch (error) {
        console.error('Marketplace error:', error);
    } finally {
        showLoading(false);
    }
}

// ===== CHAT PAGE =====
window.chatState = { 
    activeConversationId: null, 
    activeOtherUser: null, 
    seekerId: null, 
    providerId: null, 
    subscription: null 
};

async function loadChatPage() {
    if (!store.currentUser) { showPage('landing'); return; }
    await refreshConversations();
    if (!window.chatState.activeConversationId) {
        const first = document.querySelector('[data-conversation-id]');
        first ? first.click() : renderChatEmptyState();
    }
}

function renderChatEmptyState() {
    document.getElementById('chat-title').textContent = 'No conversations';
    document.getElementById('chat-messages').innerHTML = '<div class="text-center py-16"><i class="fas fa-comments text-6xl text-[#a0a0a0] mb-4"></i><p class="text-[#e0e0e0]">No messages yet</p></div>';
}

async function refreshConversations() {
    const convDiv = document.getElementById('chat-conversations');
    const noConvDiv = document.getElementById('chat-no-conversations');
    if (!convDiv || !noConvDiv) return;
    
    try {
        const conversations = await store.listConversationsForCurrentUser();
        if (!conversations?.length) {
            convDiv.innerHTML = '';
            noConvDiv.classList.remove('hidden');
            return;
        }
        noConvDiv.classList.add('hidden');
        convDiv.innerHTML = conversations.map(c => {
            const other = c.other || {};
            const name = other.name || 'User';
            const lastMsg = c.last_message || 'No messages';
            const unreadClass = c.hasUnread ? 'border-l-4 border-l-[#ff9900]' : '';
            const ratingStars = other.rating ? getRatingStars(other.rating) : '';
            
            return `
                <button data-conversation-id="${c.id}" 
                        class="w-full text-left p-4 rounded-xl bg-[#1e1e1e] hover:bg-[#2a2a2a] transition-all border border-[#2a2a2a] ${unreadClass}"
                        onclick='window.openConversation("${c.id}", ${JSON.stringify({ id: other.id, name, rating: other.rating })})'>
                    <div class="flex items-center gap-3">
                        <div class="relative">
                            <div class="w-12 h-12 rounded-full bg-[#ff9900]/20 flex items-center justify-center text-[#ff9900] font-bold">
                                ${name.charAt(0).toUpperCase()}
                            </div>
                            ${c.hasUnread ? '<span class="absolute top-0 right-0 w-3 h-3 bg-[#ff9900] rounded-full animate-ping"></span>' : ''}
                        </div>
                        <div class="flex-1">
                            <div class="flex justify-between items-center">
                                <span class="text-white font-semibold">${name}</span>
                                ${ratingStars ? `<span class="text-yellow-400 text-xs">${ratingStars}</span>` : ''}
                            </div>
                            <p class="text-[#e0e0e0] text-sm truncate mt-1">${lastMsg}</p>
                        </div>
                    </div>
                </button>
            `;
        }).join('');
    } catch (e) {
        convDiv.innerHTML = '';
        noConvDiv.classList.remove('hidden');
    }
}

async function openConversation(conversationId, otherUser) {
    window.chatState.activeConversationId = conversationId;
    window.chatState.activeOtherUser = otherUser;
    const parts = conversationId.split(':');
    window.chatState.seekerId = parts[0];
    window.chatState.providerId = parts[1];
    
    const ratingStars = otherUser.rating ? getRatingStars(otherUser.rating) : '';
    const ratingText = otherUser.rating ? ` (${otherUser.rating.toFixed(1)})` : '';
    document.getElementById('chat-title').innerHTML = `${otherUser?.name || 'Chat'}${ratingText} ${ratingStars ? `<span class="text-yellow-400 text-sm ml-2">${ratingStars}</span>` : ''}`;
    document.getElementById('chat-subtitle').textContent = 'Online · Real-time';
    
    if (window.chatState.subscription) {
        store.supabaseClient.removeChannel(window.chatState.subscription);
    }
    
    const msgContainer = document.getElementById('chat-messages');
    showLoading(true);
    try {
        const messages = await store.getChatMessages(conversationId);
        msgContainer.innerHTML = messages.length ? messages.map(m => renderMessageBubble(m)).join('') : 
            '<div class="text-center py-16 text-[#e0e0e0]">No messages yet</div>';
        msgContainer.scrollTop = msgContainer.scrollHeight;
        
        window.chatState.subscription = store.subscribeToConversation(conversationId, (newMsg) => {
            appendMessage(newMsg);
            refreshConversations();
        });
        
        store.unreadChats.delete(conversationId);
        updateNotificationBadges();
        refreshConversations();
        
    } catch (e) {
        showAlert('error', 'Failed to load messages');
    } finally {
        showLoading(false);
    }
}

function renderMessageBubble(m) {
    const mine = m.sender_id === store.currentUser?.id;
    const ts = m.created_at ? new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    
    return `
        <div class="flex ${mine ? 'justify-end' : 'justify-start'} mb-3">
            <div class="max-w-[70%] rounded-2xl px-5 py-3 ${mine ? 'bg-[#ff9900] text-white' : 'bg-[#1e1e1e] text-white border border-[#2a2a2a]'}">
                <div class="text-sm whitespace-pre-wrap break-words">${escapeHtml(m.content || '')}</div>
                <div class="flex items-center justify-end mt-1">
                    <span class="text-[10px] opacity-70 ${mine ? 'text-white/80' : 'text-[#a0a0a0]'}">${ts}</span>
                </div>
            </div>
        </div>
    `;
}

function appendMessage(m) {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    if (container.querySelector('.text-center')) container.innerHTML = '';
    container.insertAdjacentHTML('beforeend', renderMessageBubble(m));
    container.scrollTop = container.scrollHeight;
}

// ===== SERVICE HANDLERS =====
function showCreateServiceModal() {
    document.getElementById('create-service-form').reset();
    document.getElementById('create-service-error')?.classList.add('hidden');
    showModal('create-service-modal');
}

function showDeleteServiceModal(serviceId) {
    document.getElementById('delete-service-id').value = serviceId;
    showModal('delete-service-modal');
}

async function handleCreateService(data) {
    showLoading(true);
    try {
        const result = await store.createService(data);
        if (result.success) {
            showAlert('success', 'Service created successfully!');
            hideModal('create-service-modal');
            await loadProviderDashboard();
        } else {
            const err = document.getElementById('create-service-error');
            if (err) { 
                err.querySelector('span').textContent = result.error; 
                err.classList.remove('hidden'); 
            }
        }
    } catch (error) {
        showAlert('error', error.message);
    } finally {
        showLoading(false);
    }
}

async function handleDeleteService(serviceId) {
    showLoading(true);
    try {
        const result = await store.deleteService(serviceId);
        if (result.success) {
            showAlert('success', 'Service deleted successfully!');
            hideModal('delete-service-modal');
            await loadProviderDashboard();
        } else {
            showAlert('error', result.error);
        }
    } catch (error) {
        showAlert('error', error.message);
    } finally {
        showLoading(false);
    }
}

async function toggleServiceStatus(serviceId, isActive) {
    showLoading(true);
    try {
        const result = await store.toggleServiceStatus(serviceId, isActive);
        if (result.success) {
            showAlert('success', `Service ${isActive ? 'activated' : 'deactivated'}!`);
            await loadProviderDashboard();
        } else {
            showAlert('error', result.error);
        }
    } catch (error) {
        showAlert('error', error.message);
    } finally {
        showLoading(false);
    }
}

// ===== BOOKING HANDLERS =====
async function showBookServiceModal(serviceId) {
    showLoading(true);
    try {
        const service = await store.getServiceById(serviceId);
        if (!service) throw new Error('Service not found');
        
        document.getElementById('book-service-id').value = serviceId;
        document.getElementById('book-service-title').textContent = service.title;
        document.getElementById('book-service-provider').innerHTML = service.provider?.name || 'Provider';
        document.getElementById('book-service-price').textContent = `PKR ${service.price?.toFixed(2)}`;
        
        const tomorrow = new Date(); 
        tomorrow.setDate(tomorrow.getDate() + 1); 
        tomorrow.setHours(10, 0, 0, 0);
        document.getElementById('book-time').value = tomorrow.toISOString().slice(0, 16);
        document.getElementById('book-notes').value = '';
        
        showModal('book-service-modal');
    } catch (error) {
        showAlert('error', error.message);
    } finally {
        showLoading(false);
    }
}

async function handleCreateBooking(data) {
    showLoading(true);
    try {
        const result = await store.createBooking(data);
        if (result.success) {
            showAlert('success', 'Booking request submitted!');
            hideModal('book-service-modal');
            await loadSeekerDashboard();
        } else {
            const err = document.getElementById('book-service-error');
            if (err) { 
                err.querySelector('span').textContent = result.error; 
                err.classList.remove('hidden'); 
            }
        }
    } catch (error) {
        showAlert('error', error.message);
    } finally {
        showLoading(false);
    }
}

async function handleUpdateBookingStatus(bookingId, status) {
    if (!confirm(`Are you sure you want to ${status.toLowerCase()} this booking?`)) return;
    showLoading(true);
    try {
        const result = await store.updateBookingStatus(bookingId, status);
        if (result.success) {
            showAlert('success', `Booking ${status.toLowerCase()}!`);
            if (store.currentUser.role === 'PROVIDER') {
                await loadProviderDashboard();
            } else {
                await loadSeekerDashboard();
            }
        }
    } catch (error) {
        showAlert('error', error.message);
    } finally {
        showLoading(false);
    }
}

// ===== PAYMENT HANDLERS =====
async function showRequestPaymentModal(bookingId) {
    showLoading(true);
    try {
        const { data: booking, error } = await store.supabaseClient
            .from('bookings')
            .select('*, service:services(*), seeker:seeker_id(*)')
            .eq('id', bookingId)
            .single();
            
        if (error || !booking) throw new Error('Booking not found');
        
        document.getElementById('payment-booking-id').value = bookingId;
        document.getElementById('payment-service-title').textContent = booking.service?.title || 'Service';
        document.getElementById('payment-customer-name').textContent = booking.seeker?.name || 'Customer';
        document.getElementById('payment-amount').textContent = `PKR ${booking.price?.toFixed(2)}`;
        document.getElementById('payment-amount-received').value = booking.price;
        document.getElementById('payment-method').value = store.currentUser.payment_method || '';
        document.getElementById('payment-transaction-id').value = '';
        
        document.getElementById('request-payment-error').classList.add('hidden');
        
        showModal('request-payment-modal');
    } catch (error) {
        showAlert('error', error.message);
    } finally {
        showLoading(false);
    }
}

async function handleRequestPayment(data) {
    showLoading(true);
    try {
        const result = await store.createPayment({
            booking_id: data.booking_id,
            amount: data.amount,
            method: data.method,
            transaction_id: data.transaction_id
        });
        
        if (result.success) {
            showAlert('success', result.message);
            hideModal('request-payment-modal');
            await loadProviderDashboard();
            await loadProviderPaymentRequests();
        } else {
            const err = document.getElementById('request-payment-error');
            if (err) { 
                err.querySelector('span').textContent = result.error; 
                err.classList.remove('hidden'); 
            }
        }
    } catch (error) {
        showAlert('error', error.message);
    } finally {
        showLoading(false);
    }
}

async function showProcessPaymentModal(paymentId, bookingId) {
    if (!store.currentUser || store.currentUser.role !== 'SEEKER') {
        showAlert('error', 'Please login as a seeker');
        showPage('seeker-login');
        return;
    }
    
    showLoading(true);
    try {
        const { data: payment, error } = await store.supabaseClient
            .from('payments')
            .select('*, booking:bookings(*, service:services(*)), provider:provider_id(*)')
            .eq('id', paymentId)
            .single();
        
        if (error || !payment) throw new Error('Payment not found');
        
        document.getElementById('process-payment-id').value = paymentId;
        document.getElementById('process-booking-id').value = bookingId;
        document.getElementById('process-service-title').textContent = payment.booking?.service?.title || 'Service';
        document.getElementById('process-provider-name').textContent = payment.provider?.name || 'Provider';
        document.getElementById('process-payment-amount').textContent = `PKR ${payment.amount}`;
        
        document.getElementById('provider-payment-method-display').textContent = payment.provider?.payment_method || 'Not specified';
        document.getElementById('provider-payment-detail-display').textContent = payment.provider?.payment_detail || 'Not specified';
        
        document.getElementById('process-transaction-id').value = '';
        document.getElementById('process-payment-error').classList.add('hidden');
        
        showModal('process-payment-modal');
    } catch (error) {
        showAlert('error', error.message);
    } finally {
        showLoading(false);
    }
}

async function handleProcessPayment(paymentId, transactionId) {
    showLoading(true);
    try {
        const result = await store.processPayment(paymentId, transactionId);
        
        if (result.success) {
            showAlert('success', result.message);
            hideModal('process-payment-modal');
            
            const notifications = await store.getNotifications(store.currentUser.id);
            const paymentNotif = notifications.find(n => n.data?.payment_id === paymentId);
            if (paymentNotif) {
                await store.markNotificationRead(paymentNotif.id);
            }
            
            await loadSeekerDashboard();
            await loadNotifications();
            updateNotificationBadges();
        } else {
            const err = document.getElementById('process-payment-error');
            if (err) { 
                err.querySelector('span').textContent = result.error; 
                err.classList.remove('hidden'); 
            }
        }
    } catch (error) {
        showAlert('error', error.message);
    } finally {
        showLoading(false);
    }
}

function showCancelPaymentModal(paymentId) {
    document.getElementById('cancel-payment-id').value = paymentId;
    showModal('cancel-payment-modal');
}

async function handleCancelPayment(paymentId) {
    showLoading(true);
    try {
        const result = await store.cancelPayment(paymentId);
        
        if (result.success) {
            showAlert('success', result.message);
            hideModal('cancel-payment-modal');
            await loadProviderDashboard();
            await loadProviderPaymentRequests();
        } else {
            showAlert('error', result.error);
        }
    } catch (error) {
        showAlert('error', error.message);
    } finally {
        showLoading(false);
    }
}

async function loadProviderPaymentRequests() {
    if (!store.currentUser || store.currentUser.role !== 'PROVIDER') return;
    
    try {
        const payments = await store.getProviderPayments(store.currentUser.id);
        
        const pendingContainer = document.getElementById('provider-pending-requests');
        const completedContainer = document.getElementById('provider-completed-requests');
        
        const pending = payments.filter(p => p.status === 'PENDING');
        const completed = payments.filter(p => p.status === 'COMPLETED');
        
        if (pending.length === 0) {
            pendingContainer.innerHTML = '<div class="text-center py-8 bg-[#1e1e1e] rounded-xl"><p class="text-[#a0a0a0]">No pending requests</p></div>';
        } else {
            pendingContainer.innerHTML = pending.map(p => `
                <div class="bg-[#1e1e1e] rounded-xl p-4 border border-[#2a2a2a]">
                    <div class="flex justify-between items-start">
                        <div>
                            <div class="text-white font-semibold">${p.booking?.service?.title || 'Service'}</div>
                            <div class="text-[#a0a0a0] text-sm">Customer: ${p.seeker?.name || 'Customer'}</div>
                            <div class="text-[#ff9900] font-bold mt-2">PKR ${p.amount}</div>
                            <div class="text-[#a0a0a0] text-xs mt-1">${new Date(p.created_at).toLocaleString()}</div>
                        </div>
                        <div class="flex gap-2">
                            <button onclick="window.showCancelPaymentModal('${p.id}')" class="bg-red-900/30 hover:bg-red-900/50 text-red-300 px-3 py-1 rounded-lg text-sm">
                                <i class="fas fa-times"></i> Cancel
                            </button>
                        </div>
                    </div>
                </div>
            `).join('');
        }
        
        if (completed.length === 0) {
            completedContainer.innerHTML = '<div class="text-center py-8 bg-[#1e1e1e] rounded-xl"><p class="text-[#a0a0a0]">No completed payments</p></div>';
        } else {
            completedContainer.innerHTML = completed.map(p => `
                <div class="bg-[#1e1e1e] rounded-xl p-4 border border-green-800">
                    <div class="flex justify-between items-start">
                        <div>
                            <div class="text-white font-semibold">${p.booking?.service?.title || 'Service'}</div>
                            <div class="text-[#a0a0a0] text-sm">Customer: ${p.seeker?.name || 'Customer'}</div>
                            <div class="text-green-500 font-bold mt-2">PKR ${p.amount}</div>
                            <div class="text-[#a0a0a0] text-xs mt-1">TXID: ${p.transaction_id}</div>
                            <div class="text-[#a0a0a0] text-xs">${new Date(p.updated_at).toLocaleString()}</div>
                        </div>
                        <span class="px-2 py-1 bg-green-900/30 text-green-300 rounded-full text-xs">Paid</span>
                    </div>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Load provider payment requests error:', error);
    }
}

// ===== FAVORITE HANDLERS =====
async function toggleFavorite(serviceId) {
    if (!store.currentUser) { 
        showAlert('error', 'Please login'); 
        showPage('seeker-login'); 
        return; 
    }
    try {
        const result = await store.toggleFavorite(serviceId);
        if (result.success) {
            showAlert('success', result.isFav ? 'Added to favorites' : 'Removed from favorites');
            if (store.currentPage === 'seeker-marketplace') {
                await loadSeekerMarketplace();
            }
        }
    } catch (error) {
        showAlert('error', error.message);
    }
}

// ===== CHAT HANDLERS =====
async function handleSendChatMessage() {
    const input = document.getElementById('chat-input');
    if (!input || !input.value.trim()) return;
    if (!window.chatState.activeConversationId) { 
        showAlert('error', 'Select a conversation first'); 
        return; 
    }
    try {
        await store.sendChatMessage(
            window.chatState.activeConversationId, 
            input.value, 
            window.chatState.seekerId, 
            window.chatState.providerId
        );
        input.value = '';
    } catch (e) {
        showAlert('error', e.message);
    }
}

// ===== PUBLIC PROFILE =====
async function viewPublicProfile(userId) {
    if (!userId) return;
    window.currentProfileId = userId;
    showPage('public-profile');
    await loadPublicProfile(userId);
}

async function loadPublicProfile(userId) {
    const container = document.getElementById('profile-content');
    if (!container) return;

    showLoading(true);
    try {
        const user = await store.getUserById(userId);
        const ratings = await store.getUserRatings(userId);
        const ratingStats = await store.getUserRatingStats(userId);
        
        if (!user) {
            container.innerHTML = '<div class="text-center py-12"><p class="text-[#e0e0e0]">User not found</p></div>';
            return;
        }

        const ratingStars = getRatingStars(ratingStats.average);
        const avgRating = ratingStats.average.toFixed(1);

        const distribution = ratingStats.distribution;
        const total = ratingStats.total;

        let ratingsHtml = '';
        if (ratings.length > 0) {
            ratingsHtml = ratings.map(r => {
                const stars = getRatingStars(r.rating);
                return `
                    <div class="bg-[#1e1e1e] rounded-xl p-4 border border-[#2a2a2a]">
                        <div class="flex justify-between items-start mb-2">
                            <div class="font-semibold text-white">${r.rater_name}</div>
                            <div class="text-yellow-400 text-sm">${stars}</div>
                        </div>
                        <p class="text-[#e0e0e0] text-sm">${r.comment || 'No comment'}</p>
                        <p class="text-[#a0a0a0] text-xs mt-2">${new Date(r.created_at).toLocaleDateString()}</p>
                    </div>
                `;
            }).join('');
        } else {
            ratingsHtml = '<p class="text-[#a0a0a0] text-center py-4">No ratings yet</p>';
        }

        let distributionHtml = '';
        if (total > 0) {
            distributionHtml = `
                <div class="mt-6 space-y-2">
                    <h4 class="text-white font-semibold mb-3">Rating Distribution</h4>
                    ${[5,4,3,2,1].map(star => {
                        const count = distribution[star] || 0;
                        const percentage = (count / total) * 100;
                        return `
                            <div class="flex items-center gap-2">
                                <span class="text-yellow-400 text-sm w-8">${star} ★</span>
                                <div class="flex-1 h-2 bg-[#2a2a2a] rounded-full overflow-hidden">
                                    <div class="h-full bg-yellow-400 rounded-full" style="width: ${percentage}%"></div>
                                </div>
                                <span class="text-[#a0a0a0] text-xs w-12">${count} (${percentage.toFixed(1)}%)</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        }

        container.innerHTML = `
            <div class="text-center mb-8">
                <div class="w-24 h-24 rounded-full bg-[#ff9900]/20 flex items-center justify-center mx-auto mb-4">
                    <span class="text-4xl font-bold text-[#ff9900]">${user.name?.charAt(0).toUpperCase() || 'U'}</span>
                </div>
                <h1 class="text-3xl font-bold text-white mb-2">${user.name}</h1>
                <span class="px-3 py-1 bg-[#ff9900]/20 text-[#ff9900] rounded-full text-sm">${user.role}</span>
                <div class="mt-4 flex items-center justify-center gap-3">
                    <div class="flex items-center gap-2">
                        <span class="text-yellow-400 text-2xl">${ratingStars}</span>
                        <span class="text-white text-2xl font-bold">${avgRating}</span>
                    </div>
                    <span class="text-[#a0a0a0]">(${total} ${total === 1 ? 'review' : 'reviews'})</span>
                </div>
                ${distributionHtml}
                <p class="text-[#e0e0e0] mt-4">${user.email}</p>
                ${user.address ? `
                    <p class="text-[#a0a0a0] text-sm mt-2"><i class="fas fa-map-marker-alt text-[#ff9900] mr-2"></i>${user.address}</p>
                ` : ''}
                ${user.role === 'PROVIDER' && user.payment_method ? `
                    <div class="mt-4 p-4 bg-[#1e1e1e] rounded-xl">
                        <p class="text-[#a0a0a0] text-sm">Payment Method: <span class="text-white">${user.payment_method}</span></p>
                        <p class="text-[#a0a0a0] text-sm mt-1">Account: <span class="text-white">${user.payment_detail}</span></p>
                    </div>
                ` : ''}
            </div>
            <div class="mt-8">
                <h3 class="text-xl font-bold text-white mb-4">Reviews & Ratings</h3>
                <div class="space-y-3 max-h-96 overflow-y-auto custom-scrollbar pr-2">
                    ${ratingsHtml}
                </div>
            </div>
        `;
    } catch (error) {
        console.error('Load profile error:', error);
        container.innerHTML = '<div class="text-center py-12"><p class="text-[#e0e0e0]">Error loading profile</p></div>';
    } finally {
        showLoading(false);
    }
}

// ===== NAVIGATION HELPERS =====
function goBackFromProfile() {
    if (store.currentUser) {
        showPage(store.currentUser.role === 'PROVIDER' ? 'provider-dashboard' : 'seeker-dashboard');
    } else {
        showPage('landing');
    }
}

function goBackFromNotifications() {
    if (store.currentUser) {
        showPage(store.currentUser.role === 'PROVIDER' ? 'provider-dashboard' : 'seeker-dashboard');
    } else {
        showPage('landing');
    }
}

function goBackFromChat() {
    if (store.currentUser?.role === 'PROVIDER') showPage('provider-dashboard');
    else if (store.currentUser?.role === 'SEEKER') showPage('seeker-dashboard');
    else showPage('landing');
}

function goBackFromPayments() {
    if (store.currentUser?.role === 'PROVIDER') showPage('provider-dashboard');
    else showPage('landing');
}

function goBackFromProviderPayments() {
    showPage('provider-dashboard');
}

// ===== PROVIDER QR =====
function showProviderQRModal() {
    if (!store.currentUser || store.currentUser.role !== 'PROVIDER') return;
    
    const qrContainer = document.getElementById('provider-qr-code');
    const nameEl = document.getElementById('provider-qr-name');
    const methodEl = document.getElementById('provider-payment-method-display-qr');
    const detailEl = document.getElementById('provider-payment-detail-display-qr');
    
    qrContainer.innerHTML = '';
    
    if (window.QRCode) {
        new window.QRCode(qrContainer, {
            text: JSON.stringify({
                provider_id: store.currentUser.id,
                name: store.currentUser.name,
                method: store.currentUser.payment_method || 'Cash',
                details: store.currentUser.payment_detail || 'Cash on delivery',
                rating: store.currentUser.rating || 0
            }),
            width: 200,
            height: 200
        });
    }
    
    nameEl.textContent = store.currentUser.name;
    methodEl.textContent = store.currentUser.payment_method || 'Not set';
    detailEl.textContent = store.currentUser.payment_detail || 'Not set';
    
    showModal('provider-qr-modal');
}

// ===== UTILITY =====
function getStatusClass(status) {
    const classes = {
        'REQUESTED': 'bg-yellow-900/30 text-yellow-300',
        'APPROVED': 'bg-green-900/30 text-green-300',
        'COMPLETED': 'bg-[#ff9900]/30 text-[#ff9900]',
        'REJECTED': 'bg-red-900/30 text-red-300',
        'CANCELLED': 'bg-red-900/30 text-red-300',
        'OPEN': 'bg-green-900/30 text-green-300',
        'CLOSED': 'bg-gray-900/30 text-gray-300'
    };
    return classes[status] || 'bg-[#1e1e1e] text-[#e0e0e0]';
}

function getPaymentStatusClass(status) {
    const classes = {
        'PENDING': 'bg-yellow-900/30 text-yellow-300',
        'COMPLETED': 'bg-green-900/30 text-green-300',
        'FAILED': 'bg-red-900/30 text-red-300',
        'REFUNDED': 'bg-blue-900/30 text-blue-300'
    };
    return classes[status] || 'bg-[#1e1e1e] text-[#e0e0e0]';
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ===== EVENT LISTENERS =====
function setupEventListeners() {
    document.getElementById('mobile-menu-btn')?.addEventListener('click', function() {
        document.getElementById('mobile-menu')?.classList.toggle('hidden');
    });

    document.getElementById('seeker-login-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleLogin(
            document.getElementById('seeker-login-email').value,
            document.getElementById('seeker-login-password').value,
            'SEEKER', 'seeker'
        );
    });

    document.getElementById('seeker-signup-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pwd = document.getElementById('seeker-signup-password').value;
        const confirm = document.getElementById('seeker-signup-confirm').value;
        if (pwd !== confirm) { 
            const errEl = document.getElementById('seeker-signup-error');
            const errText = document.getElementById('seeker-signup-error-text');
            if (errEl && errText) { 
                errText.textContent = 'Passwords do not match'; 
                errEl.classList.remove('hidden'); 
            }
            return; 
        }
        await handleSignup({
            name: document.getElementById('seeker-signup-name').value,
            email: document.getElementById('seeker-signup-email').value,
            password: pwd,
            role: 'SEEKER'
        }, 'seeker');
    });

    document.getElementById('provider-login-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleLogin(
            document.getElementById('provider-login-email').value,
            document.getElementById('provider-login-password').value,
            'PROVIDER', 'provider'
        );
    });

    document.getElementById('provider-signup-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pwd = document.getElementById('provider-signup-password').value;
        const confirm = document.getElementById('provider-signup-confirm').value;
        const category = document.getElementById('provider-category').value;
        const lat = document.getElementById('provider-lat').value;
        const lng = document.getElementById('provider-lng').value;
        const address = document.getElementById('provider-address').value;
        
        if (pwd !== confirm) { 
            const errEl = document.getElementById('provider-signup-error');
            const errText = document.getElementById('provider-signup-error-text');
            if (errEl && errText) { 
                errText.textContent = 'Passwords do not match'; 
                errEl.classList.remove('hidden'); 
            }
            return; 
        }
        if (!category) { 
            const errEl = document.getElementById('provider-signup-error');
            const errText = document.getElementById('provider-signup-error-text');
            if (errEl && errText) { 
                errText.textContent = 'Select a category'; 
                errEl.classList.remove('hidden'); 
            }
            return; 
        }
        if (!lat || !lng) {
            const errEl = document.getElementById('provider-signup-error');
            const errText = document.getElementById('provider-signup-error-text');
            if (errEl && errText) { 
                errText.textContent = 'Please detect your location'; 
                errEl.classList.remove('hidden'); 
            }
            return;
        }
        await handleSignup({
            name: document.getElementById('provider-signup-name').value,
            email: document.getElementById('provider-signup-email').value,
            password: pwd,
            role: 'PROVIDER',
            serviceCategory: category,
            phone: document.getElementById('provider-phone')?.value,
            paymentMethod: document.getElementById('provider-payment-method').value,
            paymentDetail: document.getElementById('provider-payment-detail').value,
            lat: parseFloat(lat),
            lng: parseFloat(lng),
            address: address
        }, 'provider');
    });

    document.getElementById('create-service-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleCreateService({
            title: document.getElementById('service-title').value,
            category: document.getElementById('service-category').value,
            description: document.getElementById('service-description').value,
            price: document.getElementById('service-price').value
        });
    });

    document.getElementById('confirm-delete-service')?.addEventListener('click', async () => {
        const serviceId = document.getElementById('delete-service-id').value;
        await handleDeleteService(serviceId);
    });

    document.getElementById('book-service-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleCreateBooking({
            service_id: document.getElementById('book-service-id').value,
            scheduled_time: document.getElementById('book-time').value,
            note: document.getElementById('book-notes').value
        });
    });

    document.getElementById('quick-request-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleQuickRequest({
            category: document.getElementById('request-category').value,
            description: document.getElementById('request-description').value,
            price: document.getElementById('request-price').value
        });
    });

    document.getElementById('make-offer-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const requestId = document.getElementById('offer-request-id').value;
        const seekerId = document.getElementById('offer-seeker-id').value;
        await handleMakeOffer({
            request_id: requestId,
            seeker_id: seekerId,
            price: document.getElementById('offer-price').value,
            message: document.getElementById('offer-message').value
        });
    });

    document.getElementById('cancel-order-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const bookingId = document.getElementById('cancel-booking-id').value;
        const reason = document.getElementById('cancel-reason').value;
        const details = document.getElementById('cancel-details').value;
        
        if (!reason) {
            showAlert('error', 'Please select a cancellation reason');
            return;
        }
        
        await handleCancelOrder(bookingId, reason, details);
    });

    document.getElementById('rating-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const bookingId = document.getElementById('rating-booking-id').value;
        const targetId = document.getElementById('rating-target-id').value;
        const targetRole = document.getElementById('rating-target-role').value;
        const raterRole = document.getElementById('rating-rater-role').value;
        const rating = document.getElementById('rating-value').value;
        const comment = document.getElementById('rating-comment').value;
        
        await handleSubmitRating(bookingId, targetId, targetRole, raterRole, rating, comment);
    });

    document.getElementById('request-payment-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleRequestPayment({
            booking_id: document.getElementById('payment-booking-id').value,
            amount: document.getElementById('payment-amount-received').value,
            method: document.getElementById('payment-method').value,
            transaction_id: document.getElementById('payment-transaction-id').value
        });
    });

    document.getElementById('process-payment-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleProcessPayment(
            document.getElementById('process-payment-id').value,
            document.getElementById('process-transaction-id').value
        );
    });

    document.getElementById('confirm-cancel-payment')?.addEventListener('click', async () => {
        const paymentId = document.getElementById('cancel-payment-id').value;
        await handleCancelPayment(paymentId);
    });

    document.getElementById('chat-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleSendChatMessage();
    });

    document.getElementById('chat-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            document.getElementById('chat-form')?.dispatchEvent(new Event('submit'));
        }
    });

    const debouncedLoad = debounce(() => loadSeekerMarketplace(), 300);
    document.getElementById('seeker-search')?.addEventListener('input', debouncedLoad);
    document.getElementById('seeker-category')?.addEventListener('change', debouncedLoad);

    document.querySelectorAll('.fixed.inset-0').forEach(modal => {
        modal.addEventListener('click', function(e) {
            if (e.target === this && this.id.includes('modal')) {
                hideModal(this.id);
            }
        });
    });
}

// ===== AUTH HANDLERS =====
async function handleLogin(email, password, role, type) {
    showLoading(true);
    try {
        const result = await store.login(email, password, role);
        if (result.success) {
            showAlert('success', 'Login successful!');
            showPage(role === 'PROVIDER' ? 'provider-dashboard' : 'seeker-dashboard');
            updateNavigation();
        } else {
            const errEl = document.getElementById(`${type}-login-error`);
            const errText = document.getElementById(`${type}-login-error-text`);
            if (errEl && errText) { 
                errText.textContent = result.error; 
                errEl.classList.remove('hidden'); 
            }
        }
    } catch (error) {
        showAlert('error', error.message);
    } finally {
        showLoading(false);
    }
}

async function handleSignup(userData, type) {
    showLoading(true);
    try {
        const result = await store.signup(userData);
        if (result.success) {
            showAlert('success', 'Account created! Please login.');
            showPage(userData.role === 'PROVIDER' ? 'provider-login' : 'seeker-login');
        } else {
            const errEl = document.getElementById(`${type}-signup-error`);
            const errText = document.getElementById(`${type}-signup-error-text`);
            if (errEl && errText) { 
                errText.textContent = result.error; 
                errEl.classList.remove('hidden'); 
            }
        }
    } catch (error) {
        showAlert('error', error.message);
    } finally {
        showLoading(false);
    }
}

async function handleLogout() {
    showLoading(true);
    try {
        const result = await store.logout();
        if (result.success) {
            showAlert('success', 'Logged out successfully!');
            showPage('landing');
            updateNavigation();
        }
    } catch (error) {
        showAlert('error', error.message);
    } finally {
        showLoading(false);
    }
}

// ===== DEBOUNCE =====
function debounce(func, wait = 300) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async function() {
    await store.initSupabase();
    
    const { user } = await store.getCurrentSession();
    if (user) {
        showAlert('success', `Welcome back, ${user.name}!`);
        showPage(user.role === 'PROVIDER' ? 'provider-dashboard' : 'seeker-dashboard');
    } else {
        showPage('landing');
    }
    
    setupEventListeners();
    updateNavigation();
});

// ===== GLOBAL EXPORTS =====
window.store = store;
window.showPage = showPage;
window.showModal = showModal;
window.hideModal = hideModal;
window.showAlert = showAlert;
window.handleLogout = handleLogout;
window.handleCancelBooking = (id) => handleUpdateBookingStatus(id, 'CANCELLED');
window.handleApproveBooking = (id) => handleUpdateBookingStatus(id, 'APPROVED');
window.handleRejectBooking = (id) => handleUpdateBookingStatus(id, 'REJECTED');
window.showCancelOrderModal = showCancelOrderModal;
window.showRatingModal = showRatingModal;
window.showCreateServiceModal = showCreateServiceModal;
window.showDeleteServiceModal = showDeleteServiceModal;
window.showBookServiceModal = showBookServiceModal;
window.showRequestPaymentModal = showRequestPaymentModal;
window.showProcessPaymentModal = showProcessPaymentModal;
window.showCancelPaymentModal = showCancelPaymentModal;
window.showProviderQRModal = showProviderQRModal;
window.toggleFavorite = toggleFavorite;
window.toggleServiceStatus = toggleServiceStatus;
window.viewPublicProfile = viewPublicProfile;
window.goBackFromProfile = goBackFromProfile;
window.goBackFromNotifications = goBackFromNotifications;
window.goBackFromChat = goBackFromChat;
window.goBackFromPayments = goBackFromPayments;
window.goBackFromProviderPayments = goBackFromProviderPayments;
window.openConversation = openConversation;
window.refreshConversations = refreshConversations;
window.appendMessage = appendMessage;
window.loadSeekerMarketplace = loadSeekerMarketplace;
window.loadProviderDashboard = loadProviderDashboard;
window.loadProviderPaymentRequests = loadProviderPaymentRequests;
window.loadPaymentHistory = loadPaymentHistory;
window.updateNotificationBadges = updateNotificationBadges;
window.loadNotifications = loadNotifications;
window.markNotificationRead = markNotificationRead;
window.markAllNotificationsRead = markAllNotificationsRead;
window.updateUserLocation = updateUserLocation;
window.getProviderLocation = getProviderLocation;
window.showQuickRequestModal = showQuickRequestModal;
window.updateRequestLocation = updateRequestLocation;
window.showMakeOfferModal = showMakeOfferModal;
window.acceptOffer = acceptOffer;
window.loadNearbyRequests = loadNearbyRequests;
window.loadSeekerActiveRequests = loadSeekerActiveRequests;
