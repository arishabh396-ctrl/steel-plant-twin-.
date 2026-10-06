import streamlit as st
import simpy
import random
import statistics

# --- UI Setup ---
st.set_page_config(page_title="Steel Plant Digital Twin", layout="wide")
st.title("🏭 Steel Plant: Scrap Yard Bottleneck Simulation")
st.markdown("Adjust the operational parameters below to simulate an 8-hour shift and calculate the financial impact of truck wait times.")

# --- Interactive Sidebar Controls ---
st.sidebar.header("Operational Variables")
num_trucks = st.sidebar.slider("Trucks Arriving per Shift", 20, 100, 50)
weighbridge_count = st.sidebar.slider("Active Weighbridges", 1, 3, 1)
payloader_count = st.sidebar.slider("Active Payloaders", 1, 5, 2)
detention_cost = st.sidebar.number_input("Detention Cost (₹ per hour)", value=1000)

SIMULATION_TIME = 480 # 8 hours in minutes

if st.sidebar.button("▶ Run Simulation"):
    # --- Simulation Logic ---
    wait_times_to_unload = []
    total_turnaround_times = []

    def scrap_truck(env, weighbridge, payloaders):
        arrival_time = env.now
        
        # Weigh-in
        with weighbridge.request() as req:
            yield req
            yield env.timeout(random.uniform(3, 5))
            
        # Unload
        queue_entry_time = env.now
        with payloaders.request() as req:
            yield req
            wait_times_to_unload.append(env.now - queue_entry_time)
            yield env.timeout(random.uniform(15, 25))
            
        # Weigh-out
        with weighbridge.request() as req:
            yield req
            yield env.timeout(random.uniform(2, 4))
            
        total_turnaround_times.append(env.now - arrival_time)

    def truck_generator(env, weighbridge, payloaders):
        for _ in range(num_trucks):
            env.process(scrap_truck(env, weighbridge, payloaders))
            yield env.timeout(random.expovariate(num_trucks / SIMULATION_TIME))

    # Run the engine
    env = simpy.Environment()
    weighbridge = simpy.Resource(env, capacity=weighbridge_count)
    payloaders = simpy.Resource(env, capacity=payloader_count)
    env.process(truck_generator(env, weighbridge, payloaders))
    env.run(until=SIMULATION_TIME)
    
    # --- Analytics & UI Output ---
    if wait_times_to_unload:
        avg_wait = statistics.mean(wait_times_to_unload)
        max_wait = max(wait_times_to_unload)
        avg_turnaround = statistics.mean(total_turnaround_times)
        
        # Financial calculation (Wait time in hours * Detention Cost * Trucks)
        total_lost_hours = sum(wait_times_to_unload) / 60
        financial_loss = total_lost_hours * detention_cost

        st.subheader("Shift Results (8 Hours)")
        col1, col2, col3, col4 = st.columns(4)
        col1.metric("Trucks Processed", len(total_turnaround_times))
        col2.metric("Avg Wait Time", f"{avg_wait:.1f} min")
        col3.metric("Max Queue Time", f"{max_wait:.1f} min")
        col4.metric("Avg Total Turnaround", f"{avg_turnaround:.1f} min")
        
        st.error(f"⚠️ **Estimated Financial Loss from Queue Wait Times:** ₹{financial_loss:,.2f} per shift")
    else:
        st.warning("No trucks were processed in this time frame.")