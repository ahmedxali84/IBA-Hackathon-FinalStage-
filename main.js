// ===== SUPABASE CONFIGURATION =====
const SUPABASE_URL = 'https://appchpluexdgaonhpmbe.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwcGNocGx1ZXhkZ2FvbmhwbWJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzMDc0MzQsImV4cCI6MjA4NDg4MzQzNH0.KzzliMOY4JP-6cVM84m_yG1iJWv_ymPbucgMR6aBfZY';

// ===== DATA STORE =====
class DataStore {
    constructor() {
        this.currentUser = null;
        this.currentPage = 'landing';
        this.cache = new Map();
        this.cacheDuration = 300000;
        this.supabaseClient = null;
        this.isSupabaseLoaded = false;
    }

    // ===== SUPABASE INITIALIZATION =====
    async initSupabase() {
        console.log('🔄 Initializing Supabase...');
        
        try {
            if (typeof window.supabase === 'undefined') {
                console.log('📦 Loading Supabase from CDN...');
                await this.loadSupabaseFromCDN();
            }
            
            console.log('🔧 Creating Supabase client...');
            this.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
                auth: {
                    autoRefreshToken: true,
                    persistSession: true,
                    detectSessionInUrl: true
                }
            });
            
            this.isSupabaseLoaded = true;
            console.log('✅ Supabase initialized successfully');
            return true;
            
        } catch (error) {
            console.error('❌ Supabase initialization failed:', error);
            showAlert('error', 'Failed to connect to database. Please refresh the page.');
            return false;
        }
    }

    async loadSupabaseFromCDN() {
        return new Promise((resolve, reject) => {
            if (document.querySelector('script[src*="supabase"]')) {
                const checkInterval = setInterval(() => {
                    if (typeof window.supabase !== 'undefined') {
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 100);
                return;
            }
            
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
            script.async = true;
            
            script.onload = () => {
                console.log('✅ Supabase CDN loaded');
                resolve();
            };
            
            script.onerror = (error) => {
                console.error('❌ Failed to load Supabase CDN:', error);
                reject(new Error('Failed to load database library'));
            };
            
            document.head.appendChild(script);
        });
    }

    // ===== AUTHENTICATION =====
    async signup(userData) {
        try {
            if (!this.supabaseClient) {
                throw new Error('Database not connected');
            }

            if (!userData.email || !userData.password || !userData.name || !userData.role) {
                throw new Error('All fields are required');
            }

            if (userData.password.length < 6) {
                throw new Error('Password must be at least 6 characters');
            }

            // Check if email already exists
            const { data: existingUser, error: checkError } = await this.supabaseClient
                .from('users')
                .select('email')
                .eq('email', userData.email.toLowerCase())
                .maybeSingle();

            if (checkError && checkError.code !== 'PGRST116') {
                console.error('Check existing user error:', checkError);
            }

            if (existingUser) {
                throw new Error('Email already registered');
            }

            // Sign up
            console.log('Creating auth user...');
            const { data: authData, error: authError } = await this.supabaseClient.auth.signUp({
                email: userData.email.toLowerCase(),
                password: userData.password,
                options: {
                    data: {
                        name: userData.name,
                        role: userData.role,
                        phone: userData.phone || '',
                        service_category: userData.serviceCategory || ''
                    }
                }
            });

            if (authError) throw authError;

            // Create user profile
            console.log('Creating user profile...');
            const userProfile = {
                id: authData.user.id,
                email: userData.email.toLowerCase(),
                name: userData.name,
                role: userData.role,
                phone: userData.phone || null,
                address: userData.address || null,
                service_category: userData.serviceCategory || null,
                status: 'ACTIVE',
                last_login: new Date().toISOString(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };

            const { error: profileError } = await this.supabaseClient
                .from('users')
                .insert([userProfile]);

            if (profileError) {
                console.error('Profile creation error:', profileError);
                throw profileError;
            }

            // Auto login
            const loginResult = await this.login(userData.email, userData.password, userData.role);
            
            if (loginResult.success) {
                return { 
                    success: true,
                    user: loginResult.user,
                    message: 'Account created successfully!'
                };
            } else {
                return loginResult;
            }

        } catch (error) {
            console.error('Signup error:', error);
            return { 
                success: false, 
                error: error.message || 'Error creating account'
            };
        }
    }

    async login(email, password, role) {
        try {
            if (!this.supabaseClient) {
                throw new Error('Database not connected');
            }

            console.log('Attempting login...');
            const { data, error } = await this.supabaseClient.auth.signInWithPassword({
                email: email.toLowerCase(),
                password: password
            });

            if (error) {
                if (error.message === 'Email not confirmed') {
                    throw new Error('Please check your email for confirmation link.');
                }
                throw error;
            }

            // Get user profile
            console.log('Fetching user profile...');
            const { data: profile, error: profileError } = await this.supabaseClient
                .from('users')
                .select('*')
                .eq('id', data.user.id)
                .maybeSingle();

            if (profileError) throw profileError;
            if (!profile) throw new Error('User profile not found');

            // Check if user is active
            if (profile.status !== 'ACTIVE') {
                throw new Error('Your account is suspended. Please contact support.');
            }

            // Check role if specified
            if (role && profile.role !== role) {
                await this.supabaseClient.auth.signOut();
                throw new Error(`Please login as ${role}`);
            }

            // Update last login
            await this.supabaseClient
                .from('users')
                .update({ 
                    last_login: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .eq('id', profile.id);

            // Set current user
            this.currentUser = {
                id: profile.id,
                email: profile.email,
                name: profile.name,
                role: profile.role,
                phone: profile.phone,
                address: profile.address,
                service_category: profile.service_category,
                rating: profile.rating || 0,
                avatar_url: profile.avatar_url,
                status: profile.status
            };

            console.log('✅ Login successful:', this.currentUser.name);
            return { 
                success: true, 
                user: this.currentUser,
                message: 'Login successful!'
            };

        } catch (error) {
            console.error('Login error:', error);
            return { 
                success: false, 
                error: error.message || 'Invalid email or password'
            };
        }
    }

    async logout() {
        try {
            if (this.supabaseClient) {
                const { error } = await this.supabaseClient.auth.signOut();
                if (error) throw error;
            }
            
            this.currentUser = null;
            this.cache.clear();
            
            return { 
                success: true, 
                message: 'Logged out successfully!' 
            };
            
        } catch (error) {
            console.error('Logout error:', error);
            return { 
                success: false, 
                error: error.message 
            };
        }
    }

    async getCurrentSession() {
        try {
            if (!this.supabaseClient) {
                console.warn('Supabase not initialized');
                return { session: null, user: null };
            }

            const { data: { session }, error } = await this.supabaseClient.auth.getSession();
            
            if (error) {
                console.error('Session error:', error);
                return { session: null, user: null };
            }

            if (session && session.user) {
                // Get user profile
                const { data: profile, error: profileError } = await this.supabaseClient
                    .from('users')
                    .select('*')
                    .eq('id', session.user.id)
                    .maybeSingle();

                if (!profileError && profile) {
                    this.currentUser = {
                        id: profile.id,
                        email: profile.email,
                        name: profile.name,
                        role: profile.role,
                        phone: profile.phone,
                        address: profile.address,
                        service_category: profile.service_category,
                        rating: profile.rating || 0,
                        avatar_url: profile.avatar_url,
                        status: profile.status
                    };
                }
            }

            return { session, user: this.currentUser };
            
        } catch (error) {
            console.error('Get session error:', error);
            return { session: null, user: null };
        }
    }

    // ===== USER MANAGEMENT =====
    async updateProfile(updates) {
        try {
            if (!this.currentUser) {
                throw new Error('Not authenticated');
            }

            const { error } = await this.supabaseClient
                .from('users')
                .update({
                    ...updates,
                    updated_at: new Date().toISOString()
                })
                .eq('id', this.currentUser.id);

            if (error) throw error;

            this.currentUser = { ...this.currentUser, ...updates };

            return { 
                success: true, 
                user: this.currentUser,
                message: 'Profile updated successfully!' 
            };
            
        } catch (error) {
            console.error('Update profile error:', error);
            return { success: false, error: error.message };
        }
    }

    // ===== SERVICE MANAGEMENT =====
    async createService(serviceData) {
        try {
            if (!this.currentUser || this.currentUser.role !== 'PROVIDER') {
                throw new Error('Only providers can create services');
            }

            if (!serviceData.title || !serviceData.category || !serviceData.description || !serviceData.price) {
                throw new Error('All fields are required');
            }

            if (serviceData.price <= 0) {
                throw new Error('Price must be greater than 0');
            }

            // Optional location (enables H3 radius discovery)
            let latitude = serviceData.latitude != null && serviceData.latitude !== '' ? Number(serviceData.latitude) : null;
            let longitude = serviceData.longitude != null && serviceData.longitude !== '' ? Number(serviceData.longitude) : null;
            let h3_index = null;
            let h3_res = null;
            if (latitude != null && longitude != null && window.h3) {
                // Resolution 7 is a good balance for 5/10/25km discovery.
                h3_res = 7;
                h3_index = window.h3.latLngToCell(latitude, longitude, h3_res);
            }

            const service = {
                provider_id: this.currentUser.id,
                title: serviceData.title.trim(),
                description: serviceData.description.trim(),
                category: serviceData.category.trim(),
                price: parseFloat(serviceData.price),
                currency: serviceData.currency || 'PKR',
                duration: serviceData.duration || null,
                latitude,
                longitude,
                h3_index,
                h3_res,
                status: 'ACTIVE',
                is_active: true,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };

            const { data, error } = await this.supabaseClient
                .from('services')
                .insert([service])
                .select()
                .single();

            if (error) throw error;

            this.clearCache('services');

            return { 
                success: true, 
                service: data,
                message: 'Service created successfully!' 
            };

        } catch (error) {
            console.error('Create service error:', error);
            return { success: false, error: error.message };
        }
    }

    async getServiceById(serviceId) {
        try {
            const cacheKey = `service_${serviceId}`;
            const cached = this.cache.get(cacheKey);
            
            if (cached && Date.now() - cached.timestamp < this.cacheDuration) {
                return cached.data;
            }

            const { data, error } = await this.supabaseClient
                .from('services')
                .select(`
                    *,
                    provider:users!services_provider_id_fkey(name, email, phone, rating, avatar_url),
                    city:cities(name),
                    neighborhood:neighborhoods(name)
                `)
                .eq('id', serviceId)
                .maybeSingle();

            if (error) throw error;
            if (!data) return null;

            this.cache.set(cacheKey, {
                timestamp: Date.now(),
                data: data
            });

            return data;

        } catch (error) {
            console.error('Get service by ID error:', error);
            return null;
        }
    }

    async getServices(filters = {}) {
        try {
            const cacheKey = JSON.stringify(filters);
            const cached = this.cache.get(cacheKey);
            
            if (cached && Date.now() - cached.timestamp < this.cacheDuration) {
                return cached.data;
            }

            let query = this.supabaseClient
                .from('services')
                .select(`
                    *,
                    provider:users!services_provider_id_fkey(name, email, phone, rating, avatar_url),
                    city:cities(name),
                    neighborhood:neighborhoods(name)
                `)
                .eq('status', 'ACTIVE')
                .eq('is_active', true);

            // Apply filters
            if (filters.category) {
                query = query.eq('category', filters.category);
            }

            if (filters.provider_id) {
                query = query.eq('provider_id', filters.provider_id);
            }

            if (filters.search) {
                query = query.or(`title.ilike.%${filters.search}%,description.ilike.%${filters.search}%`);
            }

            // Uber H3: radius-based discovery (services within X km)
            // We first narrow down by H3 cells (fast), then (optionally) post-filter precisely on the client.
            if (filters.h3Cells && Array.isArray(filters.h3Cells) && filters.h3Cells.length > 0) {
                // Supabase IN can handle up to a reasonable list size; our radii (5/10/25km) stay practical.
                query = query.in('h3_index', filters.h3Cells);
            }

            // Sorting
            query = query.order('created_at', { ascending: false });

            // Pagination
            const page = filters.page || 1;
            const limit = filters.limit || 20;
            const from = (page - 1) * limit;
            const to = from + limit - 1;

            query = query.range(from, to);

            const { data, error } = await query;

            if (error) throw error;

            let result = data || [];

            // Optional precise filter (after H3 candidate selection)
            if (filters.centerLat != null && filters.centerLng != null && filters.radiusKm) {
                const centerLat = Number(filters.centerLat);
                const centerLng = Number(filters.centerLng);
                const radiusKm = Number(filters.radiusKm);
                result = result
                    .map(s => {
                        const d = haversineKm(centerLat, centerLng, Number(s.latitude), Number(s.longitude));
                        return { ...s, distance_km: isFinite(d) ? d : null };
                    })
                    .filter(s => s.distance_km == null || s.distance_km <= radiusKm)
                    .sort((a, b) => (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9));
            }
            this.cache.set(cacheKey, {
                timestamp: Date.now(),
                data: result
            });

            return result;

        } catch (error) {
            console.error('Get services error:', error);
            return [];
        }
    }

    async getServicesByProvider(providerId) {
        try {
            const services = await this.getServices({ provider_id: providerId });
            return services;
        } catch (error) {
            console.error('Get services by provider error:', error);
            return [];
        }
    }

    // ===== BOOKING MANAGEMENT =====
    async createBooking(bookingData) {
        try {
            if (!this.currentUser || this.currentUser.role !== 'SEEKER') {
                throw new Error('Only seekers can create bookings');
            }

            if (!bookingData.service_id || !bookingData.scheduled_time) {
                throw new Error('Service and time are required');
            }

            const service = await this.getServiceById(bookingData.service_id);
            if (!service) {
                throw new Error('Service not found');
            }

            if (service.status !== 'ACTIVE' || !service.is_active) {
                throw new Error('Service is not available');
            }

            if (service.provider_id === this.currentUser.id) {
                throw new Error('You cannot book your own service');
            }

            const booking = {
                service_id: bookingData.service_id,
                seeker_id: this.currentUser.id,
                provider_id: service.provider_id,
                price: service.price,
                scheduled_time: bookingData.scheduled_time,
                note: bookingData.note || '',
                status: 'REQUESTED',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };

            const { data, error } = await this.supabaseClient
                .from('bookings')
                .insert([booking])
                .select(`
                    *,
                    service:services(title, category, description),
                    seeker:users!bookings_seeker_id_fkey(name, email),
                    provider:users!bookings_provider_id_fkey(name, email)
                `)
                .maybeSingle();

            if (error) throw error;

            if (!data) {
                throw new Error('Failed to create booking');
            }

            // Generate invoice
            await this.generateInvoice(data.id);

            return { 
                success: true, 
                booking: data,
                message: 'Booking request submitted successfully!' 
            };

        } catch (error) {
            console.error('Create booking error:', error);
            return { success: false, error: error.message };
        }
    }

    async updateBookingStatus(bookingId, status) {
        try {
            if (!this.currentUser) {
                throw new Error('Not authenticated');
            }

            const { data: booking, error: getError } = await this.supabaseClient
                .from('bookings')
                .select('*')
                .eq('id', bookingId)
                .maybeSingle();

            if (getError) throw getError;
            if (!booking) throw new Error('Booking not found');

            // Check authorization
            const canUpdate = this.currentUser.role === 'ADMIN' || 
                            this.currentUser.role === 'MODERATOR' || 
                            booking.provider_id === this.currentUser.id;
            
            if (!canUpdate) {
                throw new Error('Not authorized to update this booking');
            }

            const { error } = await this.supabaseClient
                .from('bookings')
                .update({
                    status: status,
                    updated_at: new Date().toISOString()
                })
                .eq('id', bookingId);

            if (error) throw error;

            if (status === 'COMPLETED') {
                await this.generateInvoice(bookingId, true);
            }

            return { 
                success: true, 
                message: `Booking ${status.toLowerCase()} successfully!` 
            };

        } catch (error) {
            console.error('Update booking status error:', error);
            return { success: false, error: error.message };
        }
    }

    async getBookingById(bookingId) {
        try {
            const { data, error } = await this.supabaseClient
                .from('bookings')
                .select(`
                    *,
                    service:services(*),
                    seeker:users!bookings_seeker_id_fkey(name, email, phone, avatar_url),
                    provider:users!bookings_provider_id_fkey(name, email, phone, avatar_url)
                `)
                .eq('id', bookingId)
                .maybeSingle();

            if (error) throw error;
            return data;

        } catch (error) {
            console.error('Get booking by ID error:', error);
            return null;
        }
    }

    async getUserBookings(userId, filters = {}) {
        try {
            let query = this.supabaseClient
                .from('bookings')
                .select(`
                    *,
                    service:services(title, category, price, description),
                    seeker:users!bookings_seeker_id_fkey(name, email, phone, avatar_url),
                    provider:users!bookings_provider_id_fkey(name, email, phone, avatar_url)
                `)
                .or(`seeker_id.eq.${userId},provider_id.eq.${userId}`)
                .order('created_at', { ascending: false });

            if (filters.status) {
                query = query.eq('status', filters.status);
            }

            const { data, error } = await query;

            if (error) throw error;
            return data || [];

        } catch (error) {
            console.error('Get user bookings error:', error);
            return [];
        }
    }

    // ===== INVOICE GENERATION =====
    async generateInvoice(bookingId, isFinal = false) {
        try {
            const booking = await this.getBookingById(bookingId);
            if (!booking) {
                console.log('Booking not found for invoice');
                return null;
            }

            const service = await this.getServiceById(booking.service_id);
            if (!service) {
                console.log('Service not found for invoice');
                return null;
            }

            const invoiceNumber = `INV-${Date.now()}-${bookingId.slice(-8)}`;
            const invoiceDate = new Date().toISOString();
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + 7);
            
            const invoice = {
                booking_id: bookingId,
                invoice_number: invoiceNumber,
                invoice_date: invoiceDate,
                due_date: dueDate.toISOString(),
                status: isFinal ? 'PAID' : 'PENDING',
                total_amount: booking.price,
                currency: service.currency || 'PKR',
                items: [
                    {
                        description: service.title,
                        quantity: 1,
                        unit_price: booking.price,
                        total: booking.price
                    }
                ],
                customer: {
                    name: booking.seeker?.name || 'Customer',
                    email: booking.seeker?.email || '',
                    phone: booking.seeker?.phone || ''
                },
                provider: {
                    name: booking.provider?.name || 'Provider',
                    email: booking.provider?.email || '',
                    phone: booking.provider?.phone || ''
                },
                notes: booking.note || '',
                created_at: invoiceDate,
                updated_at: invoiceDate
            };

            await this.generateInvoicePDF(invoice, booking, service);

            return invoice;

        } catch (error) {
            console.error('Generate invoice error:', error);
            return null;
        }
    }

    async generateInvoicePDF(invoice, booking, service) {
        const invoiceHTML = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Invoice ${invoice.invoice_number}</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
                    .invoice-container { max-width: 800px; margin: 0 auto; background: white; border-radius: 10px; padding: 30px; box-shadow: 0 0 20px rgba(0,0,0,0.1); }
                    .header { display: flex; justify-content: space-between; margin-bottom: 40px; border-bottom: 2px solid #4F46E5; padding-bottom: 20px; }
                    .company-info h1 { color: #4F46E5; margin: 0; font-size: 24px; }
                    .invoice-info { text-align: right; }
                    .invoice-info h2 { color: #333; margin: 0 0 10px 0; font-size: 20px; }
                    .details { display: flex; justify-content: space-between; margin-bottom: 30px; gap: 20px; }
                    .section { flex: 1; }
                    .section h3 { color: #4F46E5; border-bottom: 1px solid #ddd; padding-bottom: 5px; margin-bottom: 10px; }
                    .items-table { width: 100%; border-collapse: collapse; margin: 30px 0; }
                    .items-table th { background-color: #4F46E5; color: white; padding: 12px; text-align: left; }
                    .items-table td { border: 1px solid #ddd; padding: 12px; }
                    .total { text-align: right; font-size: 18px; font-weight: bold; margin-top: 20px; padding-top: 20px; border-top: 2px solid #4F46E5; }
                    .footer { margin-top: 50px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center; color: #666; }
                    .status { display: inline-block; padding: 5px 15px; border-radius: 20px; font-weight: bold; }
                    .status-pending { background-color: #fef3c7; color: #92400e; }
                    .status-paid { background-color: #d1fae5; color: #065f46; }
                    .logo { font-size: 28px; font-weight: bold; color: #4F46E5; margin-bottom: 10px; }
                    .highlight { background-color: #f8fafc; padding: 15px; border-radius: 5px; margin: 10px 0; }
                </style>
            </head>
            <body>
                <div class="invoice-container">
                    <div class="header">
                        <div class="company-info">
                            <div class="logo">NEIGHBOURLY</div>
                            <p>Local Services Marketplace</p>
                            <p>Email: support@neighbourly.com</p>
                            <p>Phone: +92 300 1234567</p>
                        </div>
                        <div class="invoice-info">
                            <h2>INVOICE</h2>
                            <p><strong>Invoice #:</strong> ${invoice.invoice_number}</p>
                            <p><strong>Date:</strong> ${new Date(invoice.invoice_date).toLocaleDateString()}</p>
                            <p><strong>Due Date:</strong> ${new Date(invoice.due_date).toLocaleDateString()}</p>
                            <p><strong>Status:</strong> 
                                <span class="status status-${invoice.status.toLowerCase()}">
                                    ${invoice.status}
                                </span>
                            </p>
                        </div>
                    </div>
                    
                    <div class="details">
                        <div class="section">
                            <h3>Bill To:</h3>
                            <div class="highlight">
                                <p><strong>${invoice.customer.name}</strong></p>
                                <p>${invoice.customer.email}</p>
                                <p>${invoice.customer.phone}</p>
                            </div>
                        </div>
                        <div class="section">
                            <h3>Service Provider:</h3>
                            <div class="highlight">
                                <p><strong>${invoice.provider.name}</strong></p>
                                <p>${invoice.provider.email}</p>
                                <p>${invoice.provider.phone}</p>
                            </div>
                        </div>
                    </div>
                    
                    <div class="section">
                        <h3>Service Details:</h3>
                        <div class="highlight">
                            <p><strong>Service:</strong> ${service.title}</p>
                            <p><strong>Category:</strong> ${service.category}</p>
                            <p><strong>Scheduled Time:</strong> ${new Date(booking.scheduled_time).toLocaleString()}</p>
                            <p><strong>Booking ID:</strong> ${booking.id}</p>
                        </div>
                    </div>
                    
                    <table class="items-table">
                        <thead>
                            <tr>
                                <th>Description</th>
                                <th>Quantity</th>
                                <th>Unit Price</th>
                                <th>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${invoice.items.map(item => `
                                <tr>
                                    <td>${item.description}</td>
                                    <td>${item.quantity}</td>
                                    <td>${invoice.currency} ${item.unit_price.toFixed(2)}</td>
                                    <td>${invoice.currency} ${item.total.toFixed(2)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    
                    <div class="total">
                        <p><strong>Total Amount: ${invoice.currency} ${invoice.total_amount.toFixed(2)}</strong></p>
                    </div>
                    
                    <div class="section">
                        <h3>Payment Instructions:</h3>
                        <div class="highlight">
                            <p>Please make payment within 7 days</p>
                            <p>Bank Transfer: ABC Bank - 1234567890</p>
                            <p>JazzCash/Easypaisa: 0300 1234567</p>
                        </div>
                    </div>
                    
                    ${invoice.notes ? `
                        <div class="section">
                            <h3>Notes:</h3>
                            <div class="highlight">
                                <p>${invoice.notes}</p>
                            </div>
                        </div>
                    ` : ''}
                    
                    <div class="footer">
                        <p>Thank you for using Neighbourly Services!</p>
                        <p>This is a computer-generated invoice. No signature required.</p>
                        <p>Need help? Contact us at support@neighbourly.com</p>
                    </div>
                </div>
                
                <script>
                    setTimeout(() => {
                        window.print();
                        window.onafterprint = function() {
                            setTimeout(() => window.close(), 1000);
                        };
                    }, 1000);
                </script>
            </body>
            </html>
        `;

        const invoiceWindow = window.open('', '_blank');
        invoiceWindow.document.write(invoiceHTML);
        invoiceWindow.document.close();
    }

    async downloadInvoice(bookingId) {
        try {
            const booking = await this.getBookingById(bookingId);
            if (!booking) {
                throw new Error('Booking not found');
            }

            await this.generateInvoice(bookingId, booking.status === 'COMPLETED');

        } catch (error) {
            console.error('Download invoice error:', error);
            showAlert('error', 'Failed to generate invoice');
        }
    }

    // ===== STATISTICS =====
    async getStats() {
        try {
            const { count: totalServices } = await this.supabaseClient
                .from('services')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'ACTIVE')
                .eq('is_active', true);
            
            const { count: activeProviders } = await this.supabaseClient
                .from('users')
                .select('*', { count: 'exact', head: true })
                .eq('role', 'PROVIDER')
                .eq('status', 'ACTIVE');
            
            const { data: prices } = await this.supabaseClient
                .from('services')
                .select('price')
                .eq('status', 'ACTIVE')
                .eq('is_active', true);
            
            const avgPrice = prices && prices.length > 0 
                ? Math.round(prices.reduce((sum, s) => sum + s.price, 0) / prices.length)
                : 0;
            
            const { count: totalBookings } = await this.supabaseClient
                .from('bookings')
                .select('*', { count: 'exact', head: true });
            
            return {
                totalServices: totalServices || 0,
                activeProviders: activeProviders || 0,
                avgPrice: avgPrice || 0,
                totalBookings: totalBookings || 0
            };
        } catch (error) {
            console.error('Get stats error:', error);
            return { totalServices: 0, activeProviders: 0, avgPrice: 0, totalBookings: 0 };
        }
    }

    // ===== CHAT (Provider <-> Seeker) =====
    // NOTE: We intentionally DO NOT use a `conversations` table.
    // Conversation ID is deterministic: `seekerId:providerId`
    // This avoids the "table public.conversations not found" error and keeps setup simple.
    getConversationId(seekerId, providerId) {
        if (!seekerId || !providerId) throw new Error('Invalid participants');
        return `${seekerId}:${providerId}`;
    }

    async listConversationsForCurrentUser() {
        if (!this.currentUser) throw new Error('Not authenticated');
        if (!this.supabaseClient) throw new Error('Database not connected');

        // Pull recent messages involving the current user, then group by conversation_id (latest first)
        const { data, error } = await this.supabaseClient
            .from('chat_messages')
            .select('id, conversation_id, seeker_id, provider_id, sender_id, sender_name, content, created_at')
            .or(`seeker_id.eq.${this.currentUser.id},provider_id.eq.${this.currentUser.id}`)
            .order('created_at', { ascending: false })
            .limit(200);

        // If the table doesn't exist yet, give a friendly error
        if (error) throw error;

        const latestByConv = new Map();
        for (const m of (data || [])) {
            if (!latestByConv.has(m.conversation_id)) {
                latestByConv.set(m.conversation_id, m);
            }
        }

        // Build conversation cards
        const result = [];
        for (const [conversationId, lastMsg] of latestByConv.entries()) {
            const isSeeker = this.currentUser.role === 'SEEKER';
            const otherId = isSeeker ? lastMsg.provider_id : lastMsg.seeker_id;

            // Try to resolve other user's name from cached users (fallback to id)
            let otherName = 'User';
            try {
                const u = await this.getUserById(otherId);
                otherName = u?.name || otherName;
            } catch (_) {}

            result.push({
                id: conversationId,
                seeker_id: lastMsg.seeker_id,
                provider_id: lastMsg.provider_id,
                last_message_at: lastMsg.created_at,
                other: { id: otherId, name: otherName }
            });
        }

        // Already sorted by created_at desc from the query, but keep safe:
        result.sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));
        return result;
    }

    async getChatMessages(conversationId, limit = 100) {
        if (!this.supabaseClient) throw new Error('Database not connected');

        const { data, error } = await this.supabaseClient
            .from('chat_messages')
            .select('id, conversation_id, seeker_id, provider_id, sender_id, sender_name, content, created_at')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: true })
            .limit(limit);

        if (error) throw error;
        return data || [];
    }

    async sendChatMessage(conversationId, content, seekerId, providerId) {
        if (!this.currentUser) throw new Error('Not authenticated');
        if (!this.supabaseClient) throw new Error('Database not connected');

        const messageText = String(content || '').trim();
        if (!messageText) throw new Error('Message cannot be empty');

        const payload = {
            conversation_id: conversationId,
            seeker_id: seekerId,
            provider_id: providerId,
            sender_id: this.currentUser.id,
            sender_name: this.currentUser.name || 'User',
            content: messageText,
            created_at: new Date().toISOString()
        };

        const { data, error } = await this.supabaseClient
            .from('chat_messages')
            .insert([payload])
            .select('id, conversation_id, seeker_id, provider_id, sender_id, sender_name, content, created_at')
            .single();

        if (error) throw error;
        return data;
    }

    subscribeToConversation(conversationId, onInsert) {
        if (!this.supabaseClient) return null;
        const channel = this.supabaseClient
            .channel(`chat_${conversationId}`)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `conversation_id=eq.${conversationId}` },
                payload => onInsert?.(payload.new)
            )
            .subscribe();
        return channel;
    }

    // ===== HELPER METHODS =====
    hasPermission(requiredRoles) {
        if (!this.currentUser?.role) return false;
        
        const userRole = this.currentUser.role;
        const roleHierarchy = {
            'ADMIN': ['ADMIN', 'MODERATOR', 'PROVIDER', 'SEEKER'],
            'MODERATOR': ['MODERATOR', 'PROVIDER', 'SEEKER'],
            'PROVIDER': ['PROVIDER'],
            'SEEKER': ['SEEKER']
        };

        const allowedRoles = roleHierarchy[userRole] || [];
        
        if (Array.isArray(requiredRoles)) {
            return requiredRoles.some(role => allowedRoles.includes(role));
        }
        
        return allowedRoles.includes(requiredRoles);
    }

    clearCache(type = null) {
        if (type) {
            for (const [key, value] of this.cache.entries()) {
                if (key.includes(type)) {
                    this.cache.delete(key);
                }
            }
        } else {
            this.cache.clear();
        }
    }
}

// ===== APPLICATION INSTANCE =====
const store = new DataStore();

// ===== GEO HELPERS (Uber H3 + precise radius check) =====
function haversineKm(lat1, lng1, lat2, lng2) {
    if (![lat1, lng1, lat2, lng2].every(v => typeof v === 'number' && isFinite(v))) return NaN;
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

function h3CellsForRadius(centerLat, centerLng, radiusKm) {
    if (!window.h3) return [];
    const r = Number(radiusKm);
    if (!isFinite(r) || r <= 0) return [];

    // Use resolution 7 for 5/10 km; resolution 6 for 25 km to keep cell list smaller.
    const res = r <= 10 ? 7 : 6;
    const origin = window.h3.latLngToCell(centerLat, centerLng, res);
    // k chosen to reasonably cover requested radius at the chosen res.
    const k = r <= 5 ? 4 : r <= 10 ? 8 : 10;
    return window.h3.gridDisk(origin, k);
}

function debounce(fn, wait = 250) {
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), wait);
    };
}

// ===== UI HELPER FUNCTIONS =====
function showAlert(type, message) {
    let alertContainer = document.getElementById('alert-container');
    if (!alertContainer) {
        alertContainer = document.createElement('div');
        alertContainer.id = 'alert-container';
        alertContainer.className = 'fixed top-20 right-4 z-50 max-w-md';
        document.body.appendChild(alertContainer);
    }
    
    const alertId = `alert_${Date.now()}`;
    const alertHTML = `
        <div id="${alertId}" class="mb-4 animate-fade-in">
            <div class="${type === 'error' ? 'bg-red-900/90' : 'bg-green-900/90'} text-white px-6 py-4 rounded-xl shadow-lg border ${type === 'error' ? 'border-red-800' : 'border-green-800'}">
                <div class="flex items-center">
                    <i class="fas ${type === 'error' ? 'fa-exclamation-circle' : 'fa-check-circle'} mr-3"></i>
                    <span class="font-medium">${message}</span>
                </div>
            </div>
        </div>
    `;
    
    alertContainer.insertAdjacentHTML('afterbegin', alertHTML);
    
    setTimeout(() => {
        const alert = document.getElementById(alertId);
        if (alert) {
            alert.remove();
        }
    }, 5000);
}

function showLoading(show) {
    let loader = document.getElementById('loading-overlay');
    
    if (!loader) {
        loader = document.createElement('div');
        loader.id = 'loading-overlay';
        loader.className = 'hidden fixed inset-0 bg-black/50 flex items-center justify-center z-50';
        loader.innerHTML = `
            <div class="bg-dark-card rounded-2xl p-8 flex flex-col items-center">
                <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
                <p class="text-white font-medium">Loading...</p>
            </div>
        `;
        document.body.appendChild(loader);
    }
    
    if (show) {
        loader.classList.remove('hidden');
    } else {
        loader.classList.add('hidden');
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

function updateNavigation() {
    const authNav = document.getElementById('auth-nav');
    
    if (!authNav) return;
    
    if (store.currentUser) {
        const user = store.currentUser;
        authNav.innerHTML = `
            <div class="flex items-center space-x-4">
                <div class="hidden md:flex items-center space-x-3">
                    <div class="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
                        <span class="text-white font-bold">${user.name?.charAt(0) || 'U'}</span>
                    </div>
                    <div class="text-left">
                        <div class="text-white font-semibold">${user.name}</div>
                        <div class="text-dark-text-secondary text-xs capitalize">${user.role.toLowerCase()}</div>
                    </div>
                </div>
                <div class="flex space-x-2">
                    <button onclick="showProfileModal()" 
                            class="bg-primary/20 hover:bg-primary/30 text-primary px-4 py-2 rounded-xl font-semibold border border-primary/30 transition-all hover:scale-105">
                        <i class="fas fa-user mr-2"></i>Profile
                    </button>
                    <button onclick="handleLogout()" 
                            class="bg-red-900/20 hover:bg-red-900/30 text-red-300 px-4 py-2 rounded-xl font-semibold border border-red-800/30 transition-all hover:scale-105">
                        <i class="fas fa-sign-out-alt mr-2"></i>Logout
                    </button>
                </div>
            </div>
        `;
    } else {
        authNav.innerHTML = `
            <div class="flex items-center space-x-4">
                <button onclick="showPage('seeker-login')" 
                        class="bg-green-900/20 hover:bg-green-900/30 text-green-300 px-4 py-2 rounded-xl font-semibold border border-green-800/30 transition-all hover:scale-105">
                    <i class="fas fa-search mr-2"></i>Find Services
                </button>
                <button onclick="showPage('provider-login')" 
                        class="bg-gradient-to-r from-primary to-secondary text-white px-4 py-2 rounded-xl font-semibold transition-all hover:scale-105">
                    <i class="fas fa-briefcase mr-2"></i>Offer Services
                </button>
            </div>
        `;
    }
}

function showPage(pageName) {
    console.log('🔄 Switching to page:', pageName);
    
    // Hide all pages
    const pages = document.querySelectorAll('.page');
    pages.forEach(page => {
        page.classList.add('hidden');
        page.classList.remove('active');
    });
    
    // Show target page
    const targetPage = document.getElementById(`${pageName}-page`);
    if (targetPage) {
        targetPage.classList.remove('hidden');
        targetPage.classList.add('active');
        store.currentPage = pageName;
        updateNavigation();
        
        // Scroll to top
        window.scrollTo(0, 0);
        
        // Load page data
        setTimeout(() => loadCurrentPage(), 100);
    } else {
        console.error('Page not found:', pageName);
    }
}

function goBackFromDetail() {
    if (store.currentUser) {
        if (store.currentUser.role === 'PROVIDER') {
            showPage('provider-dashboard');
        } else {
            showPage('seeker-marketplace');
        }
    } else {
        showPage('landing');
    }
}

// ===== CHAT UI STATE =====
const chatState = {
    activeConversationId: null,
    activeOtherUser: null,
    seekerId: null,
    providerId: null,
    subscription: null
};

function goBackFromChat() {
    chatState.activeConversationId = chatState.activeConversationId; // keep last opened
    if (store.currentUser?.role === 'PROVIDER') showPage('provider-dashboard');
    else if (store.currentUser?.role === 'SEEKER') showPage('seeker-dashboard');
    else showPage('landing');
}

async function loadCurrentPage() {
    console.log('📄 Loading page data for:', store.currentPage);
    
    switch(store.currentPage) {
        case 'landing':
            await loadLandingPage();
            break;
        case 'seeker-dashboard':
            await loadSeekerDashboard();
            break;
        case 'seeker-marketplace':
            await loadSeekerMarketplace();
            break;
        case 'seeker-login':
            // Clear any error messages
            hideLoginError('seeker');
            break;
        case 'seeker-signup':
            hideLoginError('seeker-signup');
            break;
        case 'provider-dashboard':
            await loadProviderDashboard();
            break;
        case 'provider-login':
            hideLoginError('provider');
            break;
        case 'provider-signup':
            hideLoginError('provider-signup');
            break;
        case 'chat':
            await loadChatPage();
            break;
    }
}


// ===== MAP (Leaflet) – show user + services locations =====
let marketplaceMap = null;
let marketplaceLayer = null;
function renderMarketplaceMap(services, centerLat, centerLng, radiusKm) {
    const wrap = document.getElementById('seeker-map-wrap');
    const el = document.getElementById('seeker-map');
    const hideBtn = document.getElementById('seeker-map-hide');
    if (!wrap || !el) return;

    const lat = Number(centerLat);
    const lng = Number(centerLng);
    const r = Number(radiusKm);

    // Only show map if we have user's location
    if (!isFinite(lat) || !isFinite(lng)) {
        wrap.classList.add('hidden');
        return;
    }

    wrap.classList.remove('hidden');

    // Setup map once
    if (!marketplaceMap) {
        marketplaceMap = L.map(el, { zoomControl: true }).setView([lat, lng], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap'
        }).addTo(marketplaceMap);
    } else {
        marketplaceMap.setView([lat, lng], marketplaceMap.getZoom());
    }

    // Clear previous markers
    if (marketplaceLayer) {
        try { marketplaceLayer.clearLayers(); } catch {}
    }
    marketplaceLayer = L.layerGroup().addTo(marketplaceMap);

    // User marker
    L.marker([lat, lng]).addTo(marketplaceLayer).bindPopup('You are here').openPopup();

    // Radius circle
    if (isFinite(r) && r > 0) {
        L.circle([lat, lng], { radius: r * 1000 }).addTo(marketplaceLayer);
    }

    // Service markers
    (services || []).forEach(s => {
        const slat = Number(s.latitude);
        const slng = Number(s.longitude);
        if (!isFinite(slat) || !isFinite(slng)) return;

        const title = s.title || 'Service';
        const providerName = s.provider?.name || 'Provider';
        const price = s.price != null ? `PKR ${Number(s.price).toFixed(0)}` : '';
        const dist = s.distance_km != null ? `${Number(s.distance_km).toFixed(1)} km` : '';

        L.marker([slat, slng])
            .addTo(marketplaceLayer)
            .bindPopup(`<b>${escapeHtml(title)}</b><br/>${escapeHtml(providerName)}<br/>${price} ${dist ? `• ${dist}` : ''}`);
    });

    // Fit bounds for better view
    const pts = [[lat, lng], ...(services || []).map(s => [Number(s.latitude), Number(s.longitude)]).filter(p => isFinite(p[0]) && isFinite(p[1]))];
    if (pts.length > 1) {
        const bounds = L.latLngBounds(pts);
        marketplaceMap.fitBounds(bounds, { padding: [30, 30] });
    }

    if (hideBtn && !hideBtn.__bound) {
        hideBtn.__bound = true;
        hideBtn.addEventListener('click', () => wrap.classList.add('hidden'));
    }
}

// ===== PAGE LOADERS =====
async function loadLandingPage() {
    try {
        console.log('🌍 Loading landing page stats...');
        const stats = await store.getStats();
        const statsContainer = document.getElementById('landing-stats');
        
        if (statsContainer) {
            statsContainer.innerHTML = `
                <div class="grid grid-cols-2 md:grid-cols-4 gap-6">
                    <div class="bg-gradient-to-br from-primary/20 to-secondary/20 rounded-2xl p-6 text-center border border-primary/30">
                        <div class="text-4xl font-bold text-white">${stats.totalServices}</div>
                        <p class="text-gray-300 text-sm mt-2">Active Services</p>
                    </div>
                    <div class="bg-gradient-to-br from-green-900/20 to-emerald-900/20 rounded-2xl p-6 text-center border border-green-800/30">
                        <div class="text-4xl font-bold text-white">${stats.activeProviders}</div>
                        <p class="text-gray-300 text-sm mt-2">Trusted Providers</p>
                    </div>
                    <div class="bg-gradient-to-br from-yellow-900/20 to-amber-900/20 rounded-2xl p-6 text-center border border-yellow-800/30">
                        <div class="text-4xl font-bold text-white">PKR ${stats.avgPrice}</div>
                        <p class="text-gray-300 text-sm mt-2">Average Price</p>
                    </div>
                    <div class="bg-gradient-to-br from-purple-900/20 to-pink-900/20 rounded-2xl p-6 text-center border border-purple-800/30">
                        <div class="text-4xl font-bold text-white">${stats.totalBookings}</div>
                        <p class="text-gray-300 text-sm mt-2">Bookings Completed</p>
                    </div>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error loading landing page:', error);
    }
}

async function loadSeekerDashboard() {
    if (!store.currentUser || !store.hasPermission(['SEEKER'])) {
        showPage('landing');
        return;
    }
    
    const user = store.currentUser;
    const greetingElement = document.getElementById('seeker-greeting');
    if (greetingElement) {
        greetingElement.textContent = `Welcome back, ${user.name}`;
    }
    
    try {
        console.log('📊 Loading seeker dashboard...');
        const bookings = await store.getUserBookings(user.id);
        const stats = {
            total: bookings.length,
            pending: bookings.filter(b => b.status === 'REQUESTED').length,
            approved: bookings.filter(b => b.status === 'APPROVED').length,
            completed: bookings.filter(b => b.status === 'COMPLETED').length
        };
        
        // Update stats with null checks
        const totalBookingsElement = document.getElementById('seeker-total-bookings');
        const pendingElement = document.getElementById('seeker-pending');
        const approvedElement = document.getElementById('seeker-approved');
        const completedElement = document.getElementById('seeker-completed');
        
        if (totalBookingsElement) totalBookingsElement.textContent = stats.total;
        if (pendingElement) pendingElement.textContent = stats.pending;
        if (approvedElement) approvedElement.textContent = stats.approved;
        if (completedElement) completedElement.textContent = stats.completed;
        
        // Load recent bookings
        const container = document.getElementById('seeker-recent-bookings');
        if (container) {
            const recentBookings = bookings.slice(0, 5);
            
            if (recentBookings.length === 0) {
                container.innerHTML = `
                    <div class="text-center py-12">
                        <i class="fas fa-calendar-check text-6xl text-gray-600 mb-6"></i>
                        <p class="text-gray-400 text-lg mb-4">No bookings yet</p>
                        <p class="text-gray-500 text-sm mb-8">Start exploring services in your area</p>
                        <button onclick="showPage('seeker-marketplace')" 
                                class="bg-gradient-to-r from-primary to-secondary text-white px-8 py-3 rounded-xl font-bold text-lg hover:scale-105 transition-transform">
                            <i class="fas fa-search mr-3"></i>Browse Services
                        </button>
                    </div>
                `;
                return;
            }
            
            container.innerHTML = recentBookings.map(booking => `
                <div class="bg-white/5 rounded-2xl p-6 mb-4 hover:bg-white/10 transition-all border border-white/10">
                    <div class="flex justify-between items-start mb-4">
                        <div class="flex-1">
                            <h4 class="text-white font-bold text-lg mb-2">${booking.service?.title || 'Service'}</h4>
                            <div class="flex items-center text-gray-400 text-sm mb-2">
                                <i class="fas fa-user-circle mr-2"></i>
                                <span>${booking.provider?.name || 'Provider'}</span>
                            </div>
                            <div class="text-primary font-bold text-xl">PKR ${booking.price?.toFixed(2) || '0.00'}</div>
                        </div>
                        <span class="px-3 py-1 rounded-full text-xs font-bold ${getStatusClass(booking.status)}">
                            ${booking.status}
                        </span>
                    </div>
                    <div class="flex justify-between items-center pt-4 border-t border-white/10">
                        <div class="text-gray-400 text-sm">
                            <i class="fas fa-clock mr-2"></i>
                            ${new Date(booking.scheduled_time).toLocaleDateString()}
                        </div>
                        <div class="flex space-x-2">
                            ${booking.status === 'COMPLETED' ? `
                                <button onclick="showReviewModal('${booking.id}')" 
                                        class="bg-yellow-900/30 hover:bg-yellow-900/40 text-yellow-300 px-4 py-2 rounded-lg font-medium text-sm transition-colors">
                                    <i class="fas fa-star mr-1"></i>Review
                                </button>
                            ` : ''}
                            ${booking.status === 'REQUESTED' ? `
                                <button onclick="handleCancelBooking('${booking.id}')" 
                                        class="bg-red-900/30 hover:bg-red-900/40 text-red-300 px-4 py-2 rounded-lg font-medium text-sm transition-colors">
                                    <i class="fas fa-times mr-1"></i>Cancel
                                </button>
                            ` : ''}
                            ${['APPROVED', 'COMPLETED'].includes(booking.status) ? `
                                <button onclick="store.downloadInvoice('${booking.id}')" 
                                        class="bg-blue-900/30 hover:bg-blue-900/40 text-blue-300 px-4 py-2 rounded-lg font-medium text-sm transition-colors">
                                    <i class="fas fa-file-invoice mr-1"></i>Invoice
                                </button>
                            ` : ''}
                        </div>
                    </div>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Error loading seeker dashboard:', error);
        showAlert('error', 'Failed to load dashboard data');
    }
}

async function loadSeekerMarketplace() {
    showLoading(true);
    
    try {
        console.log('🛍️ Loading marketplace...');
        const stats = await store.getStats();
        
        // Update stats with null checks
        const totalServicesElement = document.getElementById('total-services');
        const activeProvidersElement = document.getElementById('active-providers');
        const avgPriceElement = document.getElementById('avg-price');
        const totalBookingsElement = document.getElementById('total-bookings');
        
        if (totalServicesElement) totalServicesElement.textContent = stats.totalServices || 0;
        if (activeProvidersElement) activeProvidersElement.textContent = stats.activeProviders || 0;
        if (avgPriceElement) avgPriceElement.textContent = `PKR ${stats.avgPrice || 0}`;
        if (totalBookingsElement) totalBookingsElement.textContent = stats.totalBookings || 0;
        
        // Build filters from UI
        const search = document.getElementById('seeker-search')?.value?.trim();
        const category = document.getElementById('seeker-category')?.value;
        const radiusKm = document.getElementById('seeker-radius')?.value;
        const latStr = localStorage.getItem('marketplace_lat');
        const lngStr = localStorage.getItem('marketplace_lng');
        const centerLat = latStr ? Number(latStr) : null;
        const centerLng = lngStr ? Number(lngStr) : null;

        const filters = {
            search: search || null,
            category: category || null,
            // H3 candidates (fast)
            h3Cells: (centerLat != null && centerLng != null && radiusKm) ? h3CellsForRadius(centerLat, centerLng, radiusKm) : null,
            // Optional precise post-filter (client)
            centerLat,
            centerLng,
            radiusKm
        };

        const services = await store.getServices(filters);
        
        // Update category filter
        const categories = [...new Set(services.map(s => s.category))];
        const categorySelect = document.getElementById('seeker-category');
        if (categorySelect) {
            categorySelect.innerHTML = '<option value="">All Categories</option>' + 
                categories.map(cat => `<option value="${cat}">${cat}</option>`).join('');
        }
        
        // Display services
        const grid = document.getElementById('seeker-services-grid');
        const noResults = document.getElementById('seeker-no-results');
        
        if (grid && noResults) {
            if (!services || services.length === 0) {
                grid.classList.add('hidden');
                noResults.classList.remove('hidden');
            } else {
                grid.classList.remove('hidden');
                noResults.classList.add('hidden');
                
                grid.innerHTML = services.map(service => `
                    <div class="bg-white/5 rounded-2xl p-6 hover:bg-white/10 transition-all hover:scale-[1.02] border border-white/10">
                        <div class="flex justify-between items-start mb-4">
                            <span class="px-3 py-1 bg-primary/20 text-primary rounded-full text-sm font-medium">
                                ${service.category}
                            </span>
                            <div class="text-2xl font-bold text-primary">PKR ${service.price?.toFixed(2) || '0.00'}</div>
                        </div>
                        <h3 class="text-xl font-bold text-white mb-3">${service.title}</h3>
                        <p class="text-gray-400 text-sm mb-4 line-clamp-2">${service.description}</p>
                        
                        <div class="flex items-center text-gray-400 text-sm mb-4">
                            <div class="flex items-center mr-4">
                                <i class="fas fa-user mr-2"></i>
                                <span>${service.provider?.name || 'Provider'}</span>
                            </div>
                            ${service.rating ? `
                                <div class="flex items-center">
                                    <i class="fas fa-star text-yellow-400 mr-1"></i>
                                    <span>${service.rating.toFixed(1)}</span>
                                </div>
                            ` : ''}
                        </div>
                        
                        <div class="flex justify-between items-center pt-4 border-t border-white/10">
                            <div class="text-gray-400 text-sm">
                                ${(service.distance_km != null) ? `<i class=\"fas fa-route mr-1\"></i>${service.distance_km.toFixed(1)} km away` : (service.city ? `<i class=\"fas fa-map-marker-alt mr-1\"></i>${service.city.name}` : 'Location not specified')}
                            </div>
                            <div class="flex gap-2">
                                <button onclick="openChatFromService('${service.id}')" 
                                        class="btn-secondary text-white px-4 py-2 rounded-lg font-bold hover:scale-105 transition-transform">
                                    <i class="fas fa-comments mr-2"></i>Chat
                                </button>
                                <button onclick="showBookServiceModal('${service.id}')" 
                                        class="bg-gradient-to-r from-primary to-secondary text-white px-4 py-2 rounded-lg font-bold hover:scale-105 transition-transform">
                                    <i class="fas fa-calendar-check mr-2"></i>Book
                                </button>
                            </div>
                        </div>
                    </div>
                `).join('');
            }
        }
    } catch (error) {
        console.error('Error loading marketplace:', error);
        showAlert('error', 'Failed to load services');
    } finally {
        showLoading(false);
    }
}

async function loadProviderDashboard() {
    if (!store.currentUser || !store.hasPermission(['PROVIDER'])) {
        showPage('landing');
        return;
    }
    
    const user = store.currentUser;
    const greetingElement = document.getElementById('provider-greeting');
    if (greetingElement) {
        greetingElement.textContent = `Welcome back, ${user.name}`;
    }
    
    try {
        console.log('👨‍💼 Loading provider dashboard...');
        const services = await store.getServicesByProvider(user.id);
        const bookings = await store.getUserBookings(user.id);
        
        const activeServices = services.filter(s => s.status === 'ACTIVE').length;
        const pendingBookings = bookings.filter(b => b.status === 'REQUESTED').length;
        
        let revenue = 0;
        const completedBookings = bookings.filter(b => b.status === 'COMPLETED');
        completedBookings.forEach(booking => {
            revenue += booking.price || 0;
        });
        
        // Update stats with null checks
        const activeServicesElement = document.getElementById('provider-active-services');
        const totalBookingsElement = document.getElementById('provider-total-bookings');
        const pendingElement = document.getElementById('provider-pending');
        const revenueElement = document.getElementById('provider-revenue');
        
        if (activeServicesElement) activeServicesElement.textContent = activeServices;
        if (totalBookingsElement) totalBookingsElement.textContent = bookings.length;
        if (pendingElement) pendingElement.textContent = pendingBookings;
        if (revenueElement) revenueElement.textContent = `PKR ${revenue.toFixed(2)}`;
        
        // Load recent bookings
        const container = document.getElementById('provider-recent-bookings');
        if (container) {
            const recentBookings = bookings.slice(0, 5);
            
            if (recentBookings.length === 0) {
                container.innerHTML = `
                    <div class="text-center py-12">
                        <i class="fas fa-calendar-check text-6xl text-gray-600 mb-6"></i>
                        <p class="text-gray-400 text-lg mb-4">No booking requests yet</p>
                        <p class="text-gray-500 text-sm mb-8">Add services to get booking requests</p>
                        <button onclick="showCreateServiceModal()" 
                                class="bg-gradient-to-r from-primary to-secondary text-white px-8 py-3 rounded-xl font-bold text-lg hover:scale-105 transition-transform">
                            <i class="fas fa-plus mr-3"></i>Add Service
                        </button>
                    </div>
                `;
                return;
            }
            
            container.innerHTML = recentBookings.map(booking => `
                <div class="bg-white/5 rounded-2xl p-6 mb-4 hover:bg-white/10 transition-all border border-white/10">
                    <div class="flex justify-between items-start mb-4">
                        <div class="flex-1">
                            <h4 class="text-white font-bold text-lg mb-2">${booking.service?.title || 'Service'}</h4>
                            <div class="flex items-center text-gray-400 text-sm mb-2">
                                <i class="fas fa-user-circle mr-2"></i>
                                <span>${booking.seeker?.name || 'Customer'}</span>
                            </div>
                            <div class="text-primary font-bold text-xl">PKR ${booking.price?.toFixed(2) || '0.00'}</div>
                        </div>
                        <span class="px-3 py-1 rounded-full text-xs font-bold ${getStatusClass(booking.status)}">
                            ${booking.status}
                        </span>
                    </div>
                    <div class="flex justify-between items-center pt-4 border-t border-white/10">
                        <div class="text-gray-400 text-sm">
                            <i class="fas fa-clock mr-2"></i>
                            ${new Date(booking.scheduled_time).toLocaleDateString()}
                        </div>
                        <div class="flex space-x-2">
                            <button onclick="openChatWithUser('${booking.seeker_id}', '${(booking.seeker?.name || 'Customer').replace(/'/g, "&#39;")}')" 
                                    class="bg-gray-900/30 hover:bg-gray-900/40 text-gray-200 px-4 py-2 rounded-lg font-medium text-sm transition-colors">
                                <i class="fas fa-comments mr-1"></i>Chat
                            </button>
                            ${booking.status === 'REQUESTED' ? `
                                <button onclick="handleApproveBooking('${booking.id}')" 
                                        class="bg-green-900/30 hover:bg-green-900/40 text-green-300 px-4 py-2 rounded-lg font-medium text-sm transition-colors">
                                    <i class="fas fa-check mr-1"></i>Approve
                                </button>
                                <button onclick="handleRejectBooking('${booking.id}')" 
                                        class="bg-red-900/30 hover:bg-red-900/40 text-red-300 px-4 py-2 rounded-lg font-medium text-sm transition-colors">
                                    <i class="fas fa-times mr-1"></i>Reject
                                </button>
                            ` : ''}
                            ${['APPROVED', 'COMPLETED'].includes(booking.status) ? `
                                <button onclick="store.downloadInvoice('${booking.id}')" 
                                        class="bg-blue-900/30 hover:bg-blue-900/40 text-blue-300 px-4 py-2 rounded-lg font-medium text-sm transition-colors">
                                    <i class="fas fa-file-invoice mr-1"></i>Invoice
                                </button>
                            ` : ''}
                        </div>
                    </div>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Error loading provider dashboard:', error);
        showAlert('error', 'Failed to load dashboard data');
    }
}

// ===== CHAT PAGE LOADER =====
async function loadChatPage() {
    if (!store.currentUser) {
        showPage('landing');
        return;
    }

    try {
        await refreshConversations();
        if (!chatState.activeConversationId) {
            // Auto-open first conversation if any
            const first = document.querySelector('[data-conversation-id]');
            if (first) {
                first.click();
            } else {
                renderChatEmptyState();
            }
        } else {
            await openConversation(chatState.activeConversationId, chatState.activeOtherUser);
        }
    } catch (e) {
        console.error('Load chat page error:', e);
        showAlert('error', 'Failed to load chats');
    }
}

function renderChatEmptyState() {
    const title = document.getElementById('chat-title');
    const subtitle = document.getElementById('chat-subtitle');
    const messages = document.getElementById('chat-messages');
    if (title) title.textContent = 'No conversations yet';
    if (subtitle) subtitle.textContent = 'Start a chat from a service or booking';
    if (messages) {
        messages.innerHTML = `
            <div class="text-center py-16">
                <i class="fas fa-comments text-6xl text-gray-600 mb-6"></i>
                <p class="text-gray-300 text-lg mb-2">No chats found</p>
                <p class="text-gray-500 text-sm">Seeker: open a service and click Chat. Provider: open a booking and click Chat.</p>
            </div>
        `;
    }
}

async function refreshConversations() {
    const list = document.getElementById('chat-list');
    const empty = document.getElementById('chat-empty');
    if (!list || !empty) return;

    showLoading(true);
    try {
        const conversations = await store.listConversationsForCurrentUser();
        if (!conversations || conversations.length === 0) {
            list.innerHTML = '';
            empty.classList.remove('hidden');
            return;
        }

        empty.classList.add('hidden');

        list.innerHTML = conversations.map(c => {
            const other = c.other || {};
            const name = other.name || 'User';
            const when = c.last_message_at ? new Date(c.last_message_at).toLocaleString() : '';
            // Use JSON.stringify to safely embed object into onclick
            const otherJson = JSON.stringify({ id: other.id, name });
            return `
                <button data-conversation-id="${c.id}" class="w-full text-left p-4 rounded-2xl bg-white/5 hover:bg-white/10 transition border border-white/10" onclick='openConversation("${c.id}", ${otherJson})'>
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-full bg-gradient-to-r from-primary/40 to-secondary/40 flex items-center justify-center text-white font-bold">${name.slice(0,1).toUpperCase()}</div>
                            <div>
                                <div class="text-white font-semibold">${name}</div>
                                <div class="text-gray-500 text-xs">${when}</div>
                            </div>
                        </div>
                        <i class="fas fa-chevron-right text-gray-500"></i>
                    </div>
                </button>
            `;
        }).join('');
                // Show locations on map (user + providers/services)
                renderMarketplaceMap(services, centerLat, centerLng, radiusKm);

    } catch (e) {
        console.error('refreshConversations error:', e);
        list.innerHTML = '';
        empty.classList.remove('hidden');
    } finally {
        showLoading(false);
    }
}

async function openConversation(conversationId, otherUser) {
    chatState.activeConversationId = conversationId;
    chatState.activeOtherUser = otherUser;

    // Deterministic conversation id format: seekerId:providerId
    const parts = String(conversationId || '').split(':');
    chatState.seekerId = parts[0] || null;
    chatState.providerId = parts[1] || null;

    const title = document.getElementById('chat-title');
    const subtitle = document.getElementById('chat-subtitle');
    if (title) title.textContent = otherUser?.name || 'Chat';
    if (subtitle) subtitle.textContent = 'Realtime messaging via Supabase Realtime';

    // Subscribe to new messages
    if (chatState.subscription) {
        try { await store.supabaseClient.removeChannel(chatState.subscription); } catch {}
        chatState.subscription = null;
    }

    const messagesContainer = document.getElementById('chat-messages');
    if (!messagesContainer) return;

    showLoading(true);
    try {
        const messages = await store.getChatMessages(conversationId);
        renderMessages(messages);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        chatState.subscription = store.subscribeToConversation(conversationId, async (newMsg) => {
            // Fetch sender info (optional) - keep lightweight
            appendMessage({ ...newMsg, sender_id: newMsg.sender_id });
        });
    } catch (e) {
        console.error('Open conversation error:', e);
        showAlert('error', 'Failed to load messages');
    } finally {
        showLoading(false);
    }
}

function renderMessages(messages) {
    const messagesContainer = document.getElementById('chat-messages');
    if (!messagesContainer) return;
    if (!messages || messages.length === 0) {
        messagesContainer.innerHTML = `
            <div class="text-center py-16">
                <p class="text-gray-400">No messages yet. Say hi 👋</p>
            </div>
        `;
        return;
    }

    messagesContainer.innerHTML = messages.map(m => renderMessageBubble(m)).join('');
}

function renderMessageBubble(m) {
    const mine = m.sender_id === store.currentUser?.id;
    const ts = m.created_at ? new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    return `
        <div class="flex ${mine ? 'justify-end' : 'justify-start'} mb-3">
            <div class="max-w-[80%] rounded-2xl px-4 py-3 ${mine ? 'bg-gradient-to-r from-primary to-secondary text-white' : 'bg-white/10 text-white border border-white/10'}">
                <div class="text-sm leading-relaxed">${escapeHtml(m.content || '')}</div>
                <div class="text-[10px] opacity-70 mt-1 ${mine ? 'text-white' : 'text-gray-400'}">${ts}</div>
            </div>
        </div>
    `;
}

function appendMessage(m) {
    const messagesContainer = document.getElementById('chat-messages');
    if (!messagesContainer) return;
    // If empty state was rendered, clear it
    if (messagesContainer.querySelector('.text-center')) {
        messagesContainer.innerHTML = '';
    }
    messagesContainer.insertAdjacentHTML('beforeend', renderMessageBubble(m));
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

async function handleSendChatMessage() {
    const input = document.getElementById('chat-input');
    if (!input) return;
    const content = input.value;
    if (!chatState.activeConversationId) {
        showAlert('error', 'Select a conversation first');
        return;
    }
    try {
        const sent = await store.sendChatMessage(chatState.activeConversationId, content, chatState.seekerId, chatState.providerId);
        input.value = '';
        appendMessage({ ...sent, sender_id: store.currentUser.id });
        // Refresh list order
        refreshConversations();
    } catch (e) {
        showAlert('error', e.message || 'Failed to send message');
    }
}

async function openChatFromService(serviceId) {
    try {
        if (!store.currentUser) {
            showPage('landing');
            return;
        }
        if (store.currentUser.role !== 'SEEKER') {
            showAlert('error', 'Only seekers can start chat from a service card');
            return;
        }

        const service = await store.getServiceById(serviceId);
        if (!service) throw new Error('Service not found');

        const seekerId = store.currentUser.id;
        const providerId = service.provider_id;
        const conversationId = store.getConversationId(seekerId, providerId);

        showPage('chat');

        const providerName = service.provider?.name || 'Provider';
        await openConversation(conversationId, { id: providerId, name: providerName });
        await refreshConversations();
    } catch (e) {
        console.error(e);
        showAlert('error', e.message || 'Failed to open chat');
    }
}

async function openChatWithUser(otherUserId, otherName = 'User') {
    try {
        if (!store.currentUser) {
            showPage('landing');
            return;
        }

        let seekerId, providerId;

        if (store.currentUser.role === 'PROVIDER') {
            // Provider chatting with a seeker
            providerId = store.currentUser.id;
            seekerId = otherUserId;
        } else if (store.currentUser.role === 'SEEKER') {
            // Seeker chatting with a provider
            seekerId = store.currentUser.id;
            providerId = otherUserId;
        } else {
            showAlert('error', 'Please login first');
            return;
        }

        const conversationId = store.getConversationId(seekerId, providerId);

        showPage('chat');
        await openConversation(conversationId, { id: otherUserId, name: otherName });
        await refreshConversations();
    } catch (e) {
        console.error(e);
        showAlert('error', e.message || 'Failed to open chat');
    }
}

function escapeHtml(str) {
    return String(str)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

async function loadSeekerMarketplaceWithFilters() {
    await loadSeekerMarketplace();
}

// ===== HELPER FUNCTIONS =====
function getStatusClass(status) {
    switch(status) {
        case 'REQUESTED': return 'bg-yellow-900/30 text-yellow-300';
        case 'APPROVED': return 'bg-green-900/30 text-green-300';
        case 'COMPLETED': return 'bg-primary/30 text-primary';
        case 'REJECTED':
        case 'CANCELLED': return 'bg-red-900/30 text-red-300';
        default: return 'bg-gray-900/30 text-gray-300';
    }
}

function showCreateServiceModal() {
    if (!store.currentUser || !store.hasPermission(['PROVIDER'])) {
        showAlert('error', 'Only providers can create services');
        return;
    }
    
    const createServiceForm = document.getElementById('create-service-form');
    if (createServiceForm) {
        createServiceForm.reset();
    }
    
    showModal('create-service-modal');
}

function showProfileModal() {
    if (!store.currentUser) return;
    
    const user = store.currentUser;
    const profileName = document.getElementById('profile-name');
    const profileEmail = document.getElementById('profile-email');
    const profilePhone = document.getElementById('profile-phone');
    const profileAddress = document.getElementById('profile-address');
    
    if (profileName) profileName.value = user.name || '';
    if (profileEmail) profileEmail.value = user.email || '';
    if (profilePhone) profilePhone.value = user.phone || '';
    if (profileAddress) profileAddress.value = user.address || '';
    
    showModal('profile-modal');
}

async function showBookServiceModal(serviceId) {
    if (!store.currentUser || !store.hasPermission(['SEEKER'])) {
        showAlert('error', 'Please login as a seeker to book services');
        showPage('seeker-login');
        return;
    }
    
    showLoading(true);
    
    try {
        const service = await store.getServiceById(serviceId);
        if (!service) {
            showAlert('error', 'Service not found');
            showLoading(false);
            return;
        }
        
        if (service.provider_id === store.currentUser.id) {
            showAlert('error', 'You cannot book your own service');
            showLoading(false);
            return;
        }
        
        // Get modal elements with null checks
        const serviceIdElement = document.getElementById('book-service-id');
        const serviceTitleElement = document.getElementById('book-service-title');
        const serviceProviderElement = document.getElementById('book-service-provider');
        const servicePriceElement = document.getElementById('book-service-price');
        const timeElement = document.getElementById('book-time');
        const notesElement = document.getElementById('book-notes');
        
        // Set values only if elements exist
        if (serviceIdElement) serviceIdElement.value = serviceId;
        if (serviceTitleElement) serviceTitleElement.textContent = service.title || 'Service';
        if (serviceProviderElement) serviceProviderElement.textContent = service.provider?.name || 'Provider';
        if (servicePriceElement) servicePriceElement.textContent = `PKR ${service.price?.toFixed(2) || '0.00'}`;
        
        // Set default time to tomorrow
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(10, 0, 0, 0);
        
        if (timeElement) timeElement.value = tomorrow.toISOString().slice(0, 16);
        if (notesElement) notesElement.value = '';
        
        showModal('book-service-modal');
    } catch (error) {
        console.error('Error showing book modal:', error);
        showAlert('error', 'Failed to load service details');
    } finally {
        showLoading(false);
    }
}

function hideLoginError(type) {
    const errorElement = document.getElementById(`${type}-login-error`);
    const errorSignupElement = document.getElementById(`${type}-signup-error`);
    
    if (errorElement) errorElement.classList.add('hidden');
    if (errorSignupElement) errorSignupElement.classList.add('hidden');
}

function showLoginError(type, message) {
    const errorElement = document.getElementById(`${type}-login-error`);
    const errorText = document.getElementById(`${type}-login-error-text`);
    
    if (errorElement && errorText) {
        errorText.textContent = message;
        errorElement.classList.remove('hidden');
    }
}

function showSignupError(type, message) {
    const errorElement = document.getElementById(`${type}-signup-error`);
    const errorText = document.getElementById(`${type}-signup-error-text`);
    
    if (errorElement && errorText) {
        errorText.textContent = message;
        errorElement.classList.remove('hidden');
    }
}

// ===== ACTION HANDLERS =====
async function handleLogin(email, password, role, type = 'seeker') {
    showLoading(true);
    
    try {
        const result = await store.login(email, password, role.toUpperCase());
        
        if (result.success) {
            showAlert('success', result.message);
            
            setTimeout(() => {
                if (role.toUpperCase() === 'PROVIDER') {
                    showPage('provider-dashboard');
                } else {
                    showPage('seeker-dashboard');
                }
                updateNavigation();
            }, 500);
        } else {
            showLoginError(type, result.error);
        }
    } catch (error) {
        showLoginError(type, 'Login failed. Please try again.');
    } finally {
        showLoading(false);
    }
}

async function handleSignup(userData, type = 'seeker') {
    showLoading(true);
    
    try {
        const result = await store.signup(userData);
        
        if (result.success) {
            showAlert('success', result.message);
            setTimeout(() => {
                if (userData.role === 'PROVIDER') {
                    showPage('provider-dashboard');
                } else {
                    showPage('seeker-dashboard');
                }
                updateNavigation();
            }, 500);
        } else {
            showSignupError(type, result.error);
        }
    } catch (error) {
        showSignupError(type, 'Signup failed. Please try again.');
    } finally {
        showLoading(false);
    }
}

async function handleLogout() {
    showLoading(true);
    
    try {
        const result = await store.logout();
        
        if (result.success) {
            showAlert('success', result.message);
            setTimeout(() => {
                showPage('landing');
                updateNavigation();
            }, 300);
        } else {
            showAlert('error', result.error);
        }
    } catch (error) {
        showAlert('error', 'Logout failed. Please try again.');
    } finally {
        showLoading(false);
    }
}

async function handleCreateService(serviceData) {
    showLoading(true);
    
    try {
        const result = await store.createService(serviceData);
        
        if (result.success) {
            showAlert('success', result.message);
            hideModal('create-service-modal');
            await loadProviderDashboard();
        } else {
            const errorElement = document.getElementById('create-service-error');
            if (errorElement) {
                errorElement.querySelector('span').textContent = result.error;
                errorElement.classList.remove('hidden');
            }
        }
    } catch (error) {
        const errorElement = document.getElementById('create-service-error');
        if (errorElement) {
            errorElement.querySelector('span').textContent = 'Failed to create service.';
            errorElement.classList.remove('hidden');
        }
    } finally {
        showLoading(false);
    }
}

async function handleCreateBooking(bookingData) {
    showLoading(true);
    
    try {
        const result = await store.createBooking(bookingData);
        
        if (result.success) {
            showAlert('success', result.message);
            hideModal('book-service-modal');
            await loadSeekerDashboard();
        } else {
            const errorElement = document.getElementById('book-service-error');
            if (errorElement) {
                errorElement.querySelector('span').textContent = result.error;
                errorElement.classList.remove('hidden');
            }
        }
    } catch (error) {
        const errorElement = document.getElementById('book-service-error');
        if (errorElement) {
            errorElement.querySelector('span').textContent = 'Failed to create booking.';
            errorElement.classList.remove('hidden');
        }
    } finally {
        showLoading(false);
    }
}

async function handleUpdateBookingStatus(bookingId, status) {
    showLoading(true);
    
    try {
        const result = await store.updateBookingStatus(bookingId, status);
        
        if (result.success) {
            showAlert('success', result.message);
            
            if (store.currentUser.role === 'PROVIDER') {
                await loadProviderDashboard();
            } else {
                await loadSeekerDashboard();
            }
        } else {
            showAlert('error', result.error);
        }
    } catch (error) {
        showAlert('error', 'Failed to update booking.');
    } finally {
        showLoading(false);
    }
}

async function handleCancelBooking(bookingId) {
    if (!confirm('Are you sure you want to cancel this booking?')) return;
    await handleUpdateBookingStatus(bookingId, 'CANCELLED');
}

async function handleApproveBooking(bookingId) {
    if (!confirm('Approve this booking request?')) return;
    await handleUpdateBookingStatus(bookingId, 'APPROVED');
}

async function handleRejectBooking(bookingId) {
    if (!confirm('Reject this booking request?')) return;
    await handleUpdateBookingStatus(bookingId, 'REJECTED');
}

// ===== EVENT LISTENERS =====
function setupEventListeners() {
    // Seeker Login
    const seekerLoginForm = document.getElementById('seeker-login-form');
    if (seekerLoginForm) {
        seekerLoginForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const email = document.getElementById('seeker-login-email').value;
            const password = document.getElementById('seeker-login-password').value;
            await handleLogin(email, password, 'seeker', 'seeker');
        });
    }
    
    // Seeker Signup
    const seekerSignupForm = document.getElementById('seeker-signup-form');
    if (seekerSignupForm) {
        seekerSignupForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const name = document.getElementById('seeker-signup-name').value;
            const email = document.getElementById('seeker-signup-email').value;
            const password = document.getElementById('seeker-signup-password').value;
            const confirm = document.getElementById('seeker-signup-confirm').value;
            
            if (password !== confirm) {
                showSignupError('seeker', 'Passwords do not match');
                return;
            }
            
            await handleSignup({
                name,
                email,
                password,
                role: 'SEEKER'
            }, 'seeker');
        });
    }
    
    // Provider Login
    const providerLoginForm = document.getElementById('provider-login-form');
    if (providerLoginForm) {
        providerLoginForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const email = document.getElementById('provider-login-email').value;
            const password = document.getElementById('provider-login-password').value;
            await handleLogin(email, password, 'provider', 'provider');
        });
    }
    
    // Provider Signup
    const providerSignupForm = document.getElementById('provider-signup-form');
    if (providerSignupForm) {
        providerSignupForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const name = document.getElementById('provider-signup-name').value;
            const email = document.getElementById('provider-signup-email').value;
            const password = document.getElementById('provider-signup-password').value;
            const confirm = document.getElementById('provider-signup-confirm').value;
            const category = document.getElementById('provider-category').value;
            const phone = document.getElementById('provider-phone')?.value;
            const address = document.getElementById('provider-address')?.value;
            
            if (password !== confirm) {
                showSignupError('provider', 'Passwords do not match');
                return;
            }
            
            await handleSignup({
                name,
                email,
                password,
                role: 'PROVIDER',
                serviceCategory: category,
                phone,
                address
            }, 'provider');
        });
    }
    
    // Create Service
    const createServiceForm = document.getElementById('create-service-form');
    if (createServiceForm) {
        createServiceForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const title = document.getElementById('service-title').value;
            const category = document.getElementById('service-category').value;
            const description = document.getElementById('service-description').value;
            const price = document.getElementById('service-price').value;
            const latitude = document.getElementById('service-lat')?.value;
            const longitude = document.getElementById('service-lng')?.value;
            
            await handleCreateService({
                title,
                category,
                description,
                price,
                latitude,
                longitude
            });
        });
    }

    // Provider: autofill service location
    const serviceUseLocationBtn = document.getElementById('service-use-location');
    if (serviceUseLocationBtn) {
        serviceUseLocationBtn.addEventListener('click', async () => {
            try {
                if (!navigator.geolocation) throw new Error('Geolocation not supported');
                navigator.geolocation.getCurrentPosition(pos => {
                    const lat = pos.coords.latitude;
                    const lng = pos.coords.longitude;
                    const latInput = document.getElementById('service-lat');
                    const lngInput = document.getElementById('service-lng');
                    if (latInput) latInput.value = String(lat);
                    if (lngInput) lngInput.value = String(lng);
                    showAlert('success', 'Location filled for this service');
                }, err => {
                    showAlert('error', err.message || 'Failed to get location');
                }, { enableHighAccuracy: true, timeout: 10000 });
            } catch (e) {
                showAlert('error', e.message || 'Failed to get location');
            }
        });
    }
    
    // Book Service
    const bookServiceForm = document.getElementById('book-service-form');
    if (bookServiceForm) {
        bookServiceForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const serviceId = document.getElementById('book-service-id').value;
            const time = document.getElementById('book-time').value;
            const notes = document.getElementById('book-notes').value;
            
            await handleCreateBooking({
                service_id: serviceId,
                scheduled_time: time,
                note: notes
            });
        });
    }
    
    // Profile Update
    const profileForm = document.getElementById('profile-form');
    if (profileForm) {
        profileForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const name = document.getElementById('profile-name').value;
            const phone = document.getElementById('profile-phone').value;
            const address = document.getElementById('profile-address').value;
            
            await store.updateProfile({
                name,
                phone,
                address
            });
        });
    }
    
    // Close modals on outside click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', function(e) {
            if (e.target === this) {
                hideModal(this.id);
            }
        });
    });
    
    // Navigation buttons
    document.querySelectorAll('[data-page]').forEach(btn => {
        btn.addEventListener('click', function() {
            const page = this.dataset.page;
            if (page) showPage(page);
        });
    });

    // Marketplace filters (Search / Category / Radius)
    const searchInput = document.getElementById('seeker-search');
    const categorySelect = document.getElementById('seeker-category');
    const radiusSelect = document.getElementById('seeker-radius');
    const useMyLocBtn = document.getElementById('use-my-location');

    const applyMarketplaceFilters = async () => {
        await loadSeekerMarketplaceWithFilters();
    };

    if (searchInput) {
        searchInput.addEventListener('input', debounce(applyMarketplaceFilters, 300));
    }
    if (categorySelect) {
        categorySelect.addEventListener('change', applyMarketplaceFilters);
    }
    if (radiusSelect) {
        radiusSelect.addEventListener('change', applyMarketplaceFilters);
    }
    if (useMyLocBtn) {
        useMyLocBtn.addEventListener('click', () => {
            if (!navigator.geolocation) {
                showAlert('error', 'Geolocation not supported');
                return;
            }
            navigator.geolocation.getCurrentPosition(pos => {
                localStorage.setItem('marketplace_lat', String(pos.coords.latitude));
                localStorage.setItem('marketplace_lng', String(pos.coords.longitude));
                showAlert('success', 'Location set! Now choose a radius.');
                applyMarketplaceFilters();
            }, err => {
                showAlert('error', err.message || 'Failed to get location');
            }, { enableHighAccuracy: true, timeout: 10000 });
        });
    }

    // Chat send
    const chatForm = document.getElementById('chat-form');
    if (chatForm) {
        chatForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await handleSendChatMessage();
        });
    }
}

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', async function() {
    console.log('🚀 Neighbourly App starting...');
    
    try {
        const success = await store.initSupabase();
        
        if (!success) {
            showAlert('error', 'Failed to connect to database. Please check your internet connection.');
            return;
        }
        
        const { session, user } = await store.getCurrentSession();
        
        if (user) {
            console.log('✅ User found:', user.name);
            showAlert('success', `Welcome back, ${user.name}!`);
            
            if (user.role === 'PROVIDER') {
                showPage('provider-dashboard');
            } else {
                showPage('seeker-dashboard');
            }
        } else {
            showPage('landing');
        }
        
        setupEventListeners();
        updateNavigation();
        
        console.log('✅ App initialized successfully');
        
    } catch (error) {
        console.error('❌ App initialization failed:', error);
        showAlert('error', 'Failed to initialize app. Please refresh the page.');
    }
});

// ===== GLOBAL FUNCTIONS =====
window.showPage = showPage;
window.showModal = showModal;
window.hideModal = hideModal;
window.showAlert = showAlert;
window.handleLogout = handleLogout;
window.handleCancelBooking = handleCancelBooking;
window.handleApproveBooking = handleApproveBooking;
window.handleRejectBooking = handleRejectBooking;
window.showCreateServiceModal = showCreateServiceModal;
window.showProfileModal = showProfileModal;
window.showBookServiceModal = showBookServiceModal;
window.store = store;
window.logout = handleLogout;
window.viewAllBookings = function() {
    if (store.currentUser?.role === 'PROVIDER') {
        showPage('provider-dashboard');
    } else {
        showPage('seeker-dashboard');
    }
};
window.viewProfile = function() {
    showProfileModal();
};
window.manageServices = function() {
    showPage('provider-dashboard');
};
window.manageBookings = function() {
    showPage('provider-dashboard');
};
window.searchServices = function() {
    // Implement search functionality
    console.log('Searching services...');
    loadSeekerMarketplace();
};
window.goBackFromDetail = goBackFromDetail;
window.openChatFromService = openChatFromService;
window.openChatWithUser = openChatWithUser;
window.refreshConversations = refreshConversations;
window.goBackFromChat = goBackFromChat;