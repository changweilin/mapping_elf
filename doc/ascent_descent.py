import math

class PhysiologyEngine:
    def __init__(self, body_weight=70.0, has_fatigue=True):
        self.body_weight = body_weight
        self.has_fatigue = has_fatigue
        self.g = 9.81
        
    def calculate_calories(self, met, duration_h):
        """簡單 MET 能量消耗公式"""
        return met * self.body_weight * duration_h

    def estimate_activity(self, 
                          dist_km, 
                          elev_m, 
                          pack_weight=10.0, 
                          base_met=7.5,
                          rest_every_h=1.0,  # 每走 1 小時休息一次
                          rest_duration_min=10.0): # 每次休息 10 分鐘
        
        # 1. 初始參數計算
        load_ratio = pack_weight / self.body_weight
        # 負重對速度的懲罰 (線性)
        load_penalty = max(0.5, 1.0 - (load_ratio * 1.1))
        
        v_current = 4.5 * load_penalty # 起始速度 (km/h)
        ascent_rate = 500.0 * load_penalty # 起始爬升 (m/h)
        
        # 2. 迭代模擬 (以 0.5km 為一單位進行路徑積分)
        total_moving_time = 0.0
        total_dist_covered = 0.0
        step_km = 0.5
        elev_per_step = elev_m / (dist_km / step_km)
        
        total_calories = 0.0
        
        while total_dist_covered < dist_km:
            # 疲勞計算 (若開關開啟)
            fatigue_mult = 1.0
            if self.has_fatigue:
                # 簡單疲勞模型：2 小時後每小時衰減 5%
                if total_moving_time > 2.0:
                    fatigue_mult = math.exp(-0.06 * (total_moving_time - 2.0))
                    fatigue_mult = max(0.6, fatigue_mult)
            
            # 計算該步段所需移動時間 (hr)
            move_h = (step_km / (v_current * fatigue_mult)) + (elev_per_step / (ascent_rate * fatigue_mult))
            total_moving_time += move_h
            total_dist_covered += step_km
            
            # 累加移動熱量
            total_calories += self.calculate_calories(base_met, move_h)

        # 3. 休息時間與補給計算
        num_rests = math.floor(total_moving_time / rest_every_h)
        total_rest_h = (num_rests * rest_duration_min) / 60.0
        
        # 休息時的熱量消耗 (MET=1.5)
        rest_calories = self.calculate_calories(1.5, total_rest_h)
        
        # 建議補給量 (假設每小時運動需補充 250kcal)
        suggested_intake = (total_moving_time * 250.0) 

        return {
            "config": {"fatigue_enabled": self.has_fatigue, "pack": f"{pack_weight}kg"},
            "moving_time_h": round(total_moving_time, 2),
            "rest_time_h": round(total_rest_h, 2),
            "total_elapsed_h": round(total_moving_time + total_rest_h, 2),
            "energy_expenditure_kcal": round(total_calories + rest_calories, 0),
            "suggested_intake_kcal": round(suggested_intake, 0),
            "efficiency_loss": f"{round((1 - fatigue_mult)*100, 1)}%"
        }

# --- 模擬測試：表銀座縱走某路段 (12km, 1200m 爬升, 15kg 負重) ---
engine_on = PhysiologyEngine(has_fatigue=True)
engine_off = PhysiologyEngine(has_fatigue=False)

result_fatigue = engine_on.estimate_activity(12, 1200, 15)
result_no_fatigue = engine_off.estimate_activity(12, 1200, 15)

print(f"【開拓者模式 - 有疲勞與休息】")
print(f"總耗時: {result_fatigue['total_elapsed_h']} 小時 (含休息 {result_fatigue['rest_time_h']} 小時)")
print(f"預計消耗: {result_fatigue['energy_expenditure_kcal']} kcal")
print(f"建議攜帶補給: {result_fatigue['suggested_intake_kcal']} kcal (約 5-6 條能量棒)")
print(f"終點體力衰減: {result_fatigue['efficiency_loss']}")

print(f"\n【理想數據 - 無疲勞與休息】")
print(f"總耗時: {result_no_fatigue['total_elapsed_h']} 小時")
